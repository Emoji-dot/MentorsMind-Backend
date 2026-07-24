import { Request, Response } from 'express';
import { OracleService } from '../services/oracle.service';
import { ResponseUtil } from '../utils/response.utils';

export const OracleController = {
  /** GET /api/v1/oracle/price/:asset - Current oracle price with staleness indicator */
  async getPrice(req: Request, res: Response): Promise<void> {
    const asset = req.params.asset as string;

    if (!OracleService.isConfigured()) {
      ResponseUtil.error(res, 'Oracle contract is not configured', 503);
      return;
    }

    try {
      const price = await OracleService.getPrice(asset.toUpperCase());
      ResponseUtil.success(res, price, 'Oracle price retrieved successfully');
    } catch (error) {
      ResponseUtil.error(
        res,
        error instanceof Error ? error.message : 'Failed to retrieve oracle price',
      );
    }
  },
};
