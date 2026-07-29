import { DisputeService } from '../disputes.service';
import { DisputeModel } from '../../models/dispute.model';

jest.mock('../../models/dispute.model');
jest.mock('../../models/audit-log.model');

describe('DisputeService Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadEvidence', () => {
    it('throws if user is not a party to the dispute and not an admin', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({
        id: 'dispute-1',
        filed_by_id: 'user-1',
        respondent_id: 'user-2'
      });

      await expect(
        DisputeService.uploadEvidence('dispute-1', 'third-party-user', 'learner', 'text', 'url')
      ).rejects.toThrow('Unauthorized: You are not a party to this dispute');
    });

    it('allows if user is filed_by_id', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({
        id: 'dispute-1',
        filed_by_id: 'user-1',
        respondent_id: 'user-2'
      });
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: 'evidence-1' });

      const result = await DisputeService.uploadEvidence('dispute-1', 'user-1', 'learner', 'text', 'url');
      expect(result.id).toBe('evidence-1');
    });

    it('allows if user is admin', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({
        id: 'dispute-1',
        filed_by_id: 'user-1',
        respondent_id: 'user-2'
      });
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: 'evidence-1' });

      const result = await DisputeService.uploadEvidence('dispute-1', 'admin-user', 'admin', 'text', 'url');
      expect(result.id).toBe('evidence-1');
    });
  });
});
