import { AssetExchangeService } from '../assetExchange.service';
import { stellarService } from '../stellar.service';
import { CacheService } from '../cache.service';
import { db } from '../../config/database';

jest.mock('../stellar.service', () => ({
  stellarService: {
    server: {
      strictReceivePaths: jest.fn().mockReturnThis(),
      call: jest.fn()
    }
  }
}));
jest.mock('../cache.service');
jest.mock('../../config/database', () => ({
  db: { query: jest.fn() }
}));

describe('AssetExchangeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRate', () => {
    it('returns cached rate if available', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue('0.5');

      const result = await AssetExchangeService.getRate('XLM', 'USDC');
      
      expect(result.rate).toBe('0.5');
      expect(result.pathPaymentRequired).toBe(true);
      expect(stellarService.server.strictReceivePaths).not.toHaveBeenCalled();
    });

    it('fetches rate from Stellar DEX if not cached', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (stellarService.server.strictReceivePaths().call as jest.Mock).mockResolvedValue({
        records: [
          { source_amount: '1', destination_amount: '0.5' }
        ]
      });

      const result = await AssetExchangeService.getRate('XLM', 'USDC');
      
      expect(result.rate).toBe('0.5000000');
      expect(CacheService.set).toHaveBeenCalled();
    });

    it('throws if no paths found', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (stellarService.server.strictReceivePaths().call as jest.Mock).mockResolvedValue({ records: [] });

      await expect(AssetExchangeService.getRate('XLM', 'USDC')).rejects.toThrow('No exchange path found');
    });

    it('throws if unsupported currency', async () => {
      await expect(AssetExchangeService.getRate('INVALID', 'USDC')).rejects.toThrow('Unsupported source currency');
    });
  });

  describe('validateQuote', () => {
    it('validates a valid quote', async () => {
      (db.query as jest.Mock).mockResolvedValue({
        rows: [{
          id: 'quote-1',
          source_currency: 'XLM',
          dest_currency: 'USDC',
          rate: '0.5',
          expires_at: new Date(Date.now() + 10000)
        }]
      });
      (CacheService.get as jest.Mock).mockResolvedValue('0.5'); // Mock getRate

      const result = await AssetExchangeService.validateQuote('quote-1');
      expect(result.rate).toBe('0.5');
    });

    it('throws if quote expired', async () => {
      (db.query as jest.Mock).mockResolvedValue({
        rows: [{
          id: 'quote-1',
          source_currency: 'XLM',
          dest_currency: 'USDC',
          rate: '0.5',
          expires_at: new Date(Date.now() - 10000)
        }]
      });

      await expect(AssetExchangeService.validateQuote('quote-1')).rejects.toThrow('Quote expired');
    });
  });

  describe('createQuote', () => {
    it('creates a quote', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue('0.5'); // Mock getRate
      (db.query as jest.Mock).mockResolvedValue({
        rows: [{ id: 'new-quote' }]
      });

      const result = await AssetExchangeService.createQuote('XLM', 'USDC');
      expect(result.quoteId).toBe('new-quote');
      expect(result.rate).toBe('0.5');
    });
  });
});
