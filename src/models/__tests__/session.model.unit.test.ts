import { SessionModel } from '../session.model';
import { createError } from '../../middleware/errorHandler';
import { ErrorCode } from '../../errors/error-codes';

describe('SessionModel updateMeetingUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('valid URL validation', () => {
    it('accepts valid HTTPS URL', async () => {
      ;(pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'session-1',
 meeting_url: 'https://example.com/meeting',
          meeting_provider: null,
          meeting_room_id: null,
          meeting_expires_at: null,
          updated_at: new Date()
        }]
      });

      const result = await SessionModel.updateMeetingUrl('session-1', {
        meetingUrl: 'https://example.com/meeting',
        meetingProvider: 'zoom',
        meetingRoomId: 'room-1',
        meetingExpiresAt: new Date('2024-01-01')
      });

      expect(result?.meeting_url).toBe('https://example.com/meeting');
    });

    it('accepts valid HTTP URL', async () => {
      ;(pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'session-1',
 meet_url: 'http://example.com/meeting',
          meeting_provider: null,
          meeting_room_id: null,
          meeting_expires_at: null,
          updated_at: new Date()
        }]
      });

      const result = await SessionModel.updateMeetingUrl('session-1', {
        meetingUrl: 'http://example.com/meeting',
        meetingProvider: 'daily',
        meetingRoomId: 'room-2',
        meetingExpiresAt: new Date('2024-01-01')
      });

      expect(result?.meeting_url).toBe('http://example.com/meeting');
    });
  });

  describe('invalid URL rejection', () => {
    it('throws VALIDATION_ERROR for invalid URL string', async () => {
      ;(pool.query as jest.Mock).mockRejectedValueOnce(
        createError(ErrorCode.VALIDATION_ERROR, 400)
      );

      await expect(
        SessionModel.updateMeetingUrl('session-1', {
          meetingUrl: 'not-a-valid-url',
          meetingProvider: 'zoom',
          meetingRoomId: 'room-1',
          meetingExpiresAt: new Date('2024-01-01')
        })
      ).rejects.toThrow('meetingUrl must be a valid URL');
    });
  });

  describe('null clears meeting URL', () => {
    it('allows null to clear the meeting URL', async () => {
      ;(pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'session-1',
 meeting_url: null,
          meeting_provider: null,
          meeting_room_id: null,
          meeting_expires_at: null,
          updated_at: new Date()
        }]
      });

      const result = await SessionModel.updateMeetingUrl('session-1', {
        meetingUrl: null as unknown as string,
        meetingProvider: 'zoom',
        meetingRoomId: 'room-1',
        meetingExpiresAt: new Date('2024-01-01')
      });

      expect(result?.meeting_url).toBeNull();
    });
  });
});