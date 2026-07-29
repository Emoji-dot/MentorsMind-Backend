import { DisputeService } from '../disputes.service';
import pool from '../../config/database';
import { DisputeModel } from '../../models/dispute.model';
import { AuditLogModel } from '../../models/audit-log.model';
import { SorobanEscrowService } from '../sorobanEscrow.service';
import { NotificationService } from '../notification.service';
import { DatabaseService } from '../database.service';
import { DisputeStateMachine } from '../dispute-state-machine.service';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  }
}));
jest.mock('../../models/dispute.model');
jest.mock('../../models/audit-log.model');
jest.mock('../sorobanEscrow.service');
jest.mock('../notification.service');
jest.mock('../database.service');
jest.mock('../dispute-state-machine.service');

describe('DisputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('openDispute', () => {
    it('opens a dispute successfully', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-1', mentee_id: 'mentee-1' }]
      });
      (DisputeModel.create as jest.Mock).mockResolvedValue({ id: 'dispute-1' });

      const result = await DisputeService.openDispute('session-1', 'mentee-1', 'quality', 'test reason');
      expect(result.id).toBe('dispute-1');
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
      expect(AuditLogModel.create).toHaveBeenCalled();
    });

    it('throws if booking not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(DisputeService.openDispute('session-1', 'mentee-1', 'quality', 'test reason'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('uploadEvidence', () => {
    it('uploads evidence successfully', async () => {
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: 'evidence-1' });
      const result = await DisputeService.uploadEvidence('dispute-1', 'user-1', 'text');
      expect(result.id).toBe('evidence-1');
      expect(AuditLogModel.create).toHaveBeenCalled();
    });
  });

  describe('escalateOldDisputes', () => {
    it('escalates old disputes', async () => {
      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue([
        { id: 'dispute-1', status: 'opened', session_id: 'session-1', filed_by_id: 'user-1' }
      ]);
      (DisputeStateMachine.canTransition as jest.Mock).mockReturnValue(true);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-1', mentee_id: 'user-1' }]
      });

      const count = await DisputeService.escalateOldDisputes();
      expect(count).toBe(1);
      expect(DisputeModel.updateStatus).toHaveBeenCalledWith('dispute-1', 'investigating', expect.any(String));
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('mediateDispute', () => {
    it('moves dispute to mediation', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'investigating' });
      (DisputeModel.updateStatus as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'mediation' });
      (DisputeStateMachine.assertTransition as jest.Mock).mockImplementation(() => {});

      const result = await DisputeService.mediateDispute('dispute-1', 'admin-1', 'notes');
      expect(result.status).toBe('mediation');
      expect(AuditLogModel.create).toHaveBeenCalled();
    });
  });

  describe('resolveDispute', () => {
    it('resolves dispute and triggers escrow', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'investigating', session_id: 'session-1', filed_by_id: 'mentee-1' });
      (DisputeStateMachine.assertTransition as jest.Mock).mockImplementation(() => {});
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ escrow_id: 'escrow-1', mentor_id: 'mentor-1', mentee_id: 'mentee-1' }]
      });
      (DatabaseService.withTransaction as jest.Mock).mockImplementation(async (cb) => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'dispute-1', status: 'resolved' }] }) };
        return cb(client);
      });

      const result = await DisputeService.resolveDispute('dispute-1', 'admin-1', 50, 'resolved notes');
      
      expect(result.status).toBe('resolved');
      expect(SorobanEscrowService.resolveDispute).toHaveBeenCalled();
      expect(AuditLogModel.create).toHaveBeenCalled();
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('throws if no escrow ID is found', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', session_id: 'session-1' });
      (pool.query as jest.Mock).mockResolvedValue({ rows: [{ escrow_id: null }] });

      await expect(DisputeService.resolveDispute('dispute-1', 'admin-1', 50, 'notes'))
        .rejects.toThrow('No escrow_id found');
    });
  });
});
