import pool from '../../config/database';
import { CacheService } from '../cache.service';
import { MentorsService } from '../mentors.service';
import { SocketService } from '../socket.service';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../cache.service', () => ({
  CacheService: {
    del: jest.fn(),
  },
}));

jest.mock('../socket.service', () => ({
  SocketService: {
    emitMentorAvailabilityChanged: jest.fn(),
  },
}));

describe('MentorsService.setAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('broadcasts a realtime availability update after persisting the change', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: 'mentor-1',
          email: 'mentor@example.com',
          role: 'mentor',
          first_name: 'Ada',
          last_name: 'Lovelace',
          bio: null,
          avatar_url: null,
          hourly_rate: 50,
          expertise: ['engineering'],
          years_of_experience: 10,
          availability_schedule: { monday: ['09:00-17:00'] },
          is_available: false,
          timezone: 'UTC',
          average_rating: 4.9,
          total_sessions_completed: 12,
          total_reviews: 3,
          kyc_verified: true,
          is_active: true,
          quality_score: 95,
          quality_tier: 'gold',
          created_at: new Date('2024-01-01T00:00:00.000Z'),
          updated_at: new Date('2024-01-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await MentorsService.setAvailability('mentor-1', {
      schedule: {
        monday: {
          enabled: true,
          slots: [{ start: '09:00', end: '17:00' }],
        },
      },
      isAvailable: false,
    });

    expect(result?.id).toBe('mentor-1');
    expect(CacheService.del).toHaveBeenCalled();
    expect(SocketService.emitMentorAvailabilityChanged).toHaveBeenCalledWith(
      'mentor-1',
      expect.objectContaining({
        mentorId: 'mentor-1',
        isAvailable: false,
        availability: {
          schedule: {
            monday: {
              enabled: true,
              slots: [{ start: '09:00', end: '17:00' }],
            },
          },
          isAvailable: false,
        },
      }),
    );
  });
});
