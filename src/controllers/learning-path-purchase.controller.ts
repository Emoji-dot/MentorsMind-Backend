import { Request, Response } from "express";
import { EnrollmentService } from "../services/enrollment.service";
import { createError } from "../middleware/errorHandler";
import { logger } from "../utils/logger.utils";

export const LearningPathPurchaseController = {
  async getPurchaseInfo(req: Request, res: Response): Promise<void> {
    const { pathId } = req.params as Record<string, string>;
    const userId = req.user?.id;

    if (!pathId) {
      throw createError("Path ID is required", 400);
    }

    const purchaseInfo = await EnrollmentService.getPurchaseInfo(pathId, userId);
    res.json({
      success: true,
      data: purchaseInfo,
    });
  },

  async startTrial(req: Request, res: Response): Promise<void> {
    const { pathId } = req.params as Record<string, string>;
    const userId = req.user?.id;

    if (!userId) {
      throw createError("Authentication required", 401);
    }

    if (!pathId) {
      throw createError("Path ID is required", 400);
    }

    const enrollment = await EnrollmentService.startTrial(pathId, userId);

    logger.info("Learning path trial started", {
      pathId,
      studentId: userId,
      enrollmentId: enrollment.id,
    });

    res.status(201).json({
      success: true,
      data: enrollment,
      message: "Trial enrollment started",
    });
  },
};

