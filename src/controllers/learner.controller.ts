import { Request, Response, NextFunction } from 'express';
import { LearnerService } from '../services/learners.service';
import { GoalService } from '../services/goal.service';

export class LearnerController {
  static async getProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const progress = await LearnerService.getProgressSummary(learnerId);
      res.json({ status: 'success', data: progress });
    } catch (err) { next(err); }
  }

  static async getGoalCompletionTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const timeline = await LearnerService.getGoalCompletionTimeline(learnerId);
      res.json({ status: 'success', data: timeline });
    } catch (err) { next(err); }
  }

  static async getSessionTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const timeline = await LearnerService.getSessionTimeline(learnerId);
      res.json({ status: 'success', data: timeline });
    } catch (err) { next(err); }
  }

  static async getAtRiskGoals(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const goals = await GoalService.listAtRiskGoals(learnerId);
      res.json({ status: 'success', data: goals });
    } catch (err) { next(err); }
  }
}
