import { Request, Response } from "express";
import { AvailabilityPredictionService } from "../services/availability-prediction.service";

export class AvailabilityPredictionController {
  static async getPredictions(req: Request, res: Response): Promise<void> {
    const { mentorId } = req.params as Record<string, string>;
    const daysAhead = parseInt(req.query.daysAhead as string) || 14;
    const prediction = await AvailabilityPredictionService.predictAvailability(
      mentorId,
      daysAhead,
    );
    res.json({ success: true, data: prediction });
  }

  static async getDemandForecast(req: Request, res: Response): Promise<void> {
    const { mentorId } = req.params as Record<string, string>;
    const forecast =
      await AvailabilityPredictionService.getDemandForecast(mentorId);
    res.json({ success: true, data: forecast });
  }

  static async addToWaitlist(req: Request, res: Response): Promise<void> {
    const { mentorId } = req.params as Record<string, string>;
    const { userId, preferredSlot } = req.body;
    const entry = await AvailabilityPredictionService.addToWaitlist(
      mentorId,
      userId,
      new Date(preferredSlot),
    );
    res.status(201).json({ success: true, data: entry });
  }

  static async getWaitlist(req: Request, res: Response): Promise<void> {
    const { mentorId } = req.params as Record<string, string>;
    const waitlist = await AvailabilityPredictionService.getWaitlist(mentorId);
    res.json({ success: true, data: waitlist });
  }
}
