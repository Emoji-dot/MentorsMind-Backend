import { AISummaryService } from '../ai-summary.service';
import axios from 'axios';

jest.mock('axios');

describe('AISummaryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-openai-key', ANTHROPIC_API_KEY: 'test-anthropic-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('generateSummary', () => {
    it('generates summary using OpenAI', async () => {
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          model: 'gpt-4',
          usage: { total_tokens: 100 },
          choices: [{
            message: {
              content: JSON.stringify({
                keyTopics: ['Topic 1'],
                actionItems: [{ description: 'Action 1' }],
                learningOutcomes: ['Outcome 1'],
                nextSteps: ['Step 1']
              })
            }
          }]
        }
      });

      const result = await AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'This is a long transcript'.repeat(20),
        sessionId: 'session-1'
      });

      expect(result.provider).toBe('openai');
      expect(result.summary.keyTopics).toContain('Topic 1');
      expect(result.summary.actionItems[0].description).toBe('Action 1');
    });

    it('falls back to Anthropic if OpenAI fails', async () => {
      (axios.post as jest.Mock)
        .mockRejectedValueOnce(new Error('OpenAI Error')) // OpenAI fails
        .mockResolvedValueOnce({
          data: {
            model: 'claude-3',
            usage: { input_tokens: 50, output_tokens: 50 },
            content: [{
              text: JSON.stringify({
                keyTopics: ['Topic A'],
                actionItems: [],
                learningOutcomes: [],
                nextSteps: []
              })
            }]
          }
        }); // Anthropic succeeds

      const result = await AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'This is a long transcript'.repeat(20),
        sessionId: 'session-1'
      });

      expect(result.provider).toBe('anthropic');
      expect(result.summary.keyTopics).toContain('Topic A');
    });

    it('throws if both providers fail', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'This is a long transcript'.repeat(20)
      })).rejects.toThrow('All AI providers unavailable');
    });

    it('throws if content is insufficient', async () => {
      await expect(AISummaryService.generateSummary({
        bookingId: 'booking-1',
        transcriptText: 'Short'
      })).rejects.toThrow('Insufficient content');
    });
  });

  describe('generateRecommendations', () => {
    const mockSummary = {
      sessionId: 'session-1',
      keyTopics: ['Topic 1'],
      actionItems: [{ description: 'Action 1', completed: false }],
      learningOutcomes: ['Outcome 1'],
      nextSteps: ['Step 1'],
      aiConfidence: 0.9
    };

    it('generates recommendations using AI', async () => {
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                recommendations: ['Rec 1', 'Rec 2']
              })
            }
          }]
        }
      });

      const result = await AISummaryService.generateRecommendations(mockSummary);
      expect(result).toEqual(['Rec 1', 'Rec 2']);
    });

    it('falls back to simple recommendations if AI fails', async () => {
      (axios.post as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

      const result = await AISummaryService.generateRecommendations(mockSummary);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('Topic 1');
    });

    it('falls back to simple recommendations if no API key', async () => {
      delete process.env.OPENAI_API_KEY;

      const result = await AISummaryService.generateRecommendations(mockSummary);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('Topic 1');
    });
  });
});
