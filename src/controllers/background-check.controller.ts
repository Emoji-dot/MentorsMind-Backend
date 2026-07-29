import { Request, Response } from "express";
import { BackgroundCheckService } from "../services/background-check.service";

export const BackgroundCheckController = {
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const backgroundCheck = await BackgroundCheckService.handleProviderWebhook(req.body);
    res.json({
      success: true,
      data: backgroundCheck,
    });
  },
};

