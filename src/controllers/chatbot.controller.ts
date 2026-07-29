import { Request, Response } from "express";
import { z } from "zod";
import { chatbotService, UserProfile } from "../services/chatbot.service";
import { createError } from "../middleware/errorHandler";

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  userProfile: z
    .object({
      name: z.string().default("User"),
      role: z.enum(["mentor", "mentee"]).default("mentee"),
      language: z.string().optional(),
    })
    .partial()
    .optional(),
});

export const ChatbotController = {
  async chat(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw createError("Authentication required", 401);
    }

    const body = ChatRequestSchema.parse(req.body);
    const userProfile: UserProfile = {
      id: userId,
      name: body.userProfile?.name || req.user?.email || "User",
      role: body.userProfile?.role || (req.user?.role === "mentor" ? "mentor" : "mentee"),
      language: body.userProfile?.language,
    };

    const message = await chatbotService.chat(userId, body.message, userProfile);
    res.status(201).json({
      success: true,
      data: message,
    });
  },

  async history(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw createError("Authentication required", 401);
    }

    const limit = Math.min(Number(req.query.limit || 100), 100);
    const history = await chatbotService.getHistory(userId, limit);
    res.json({
      success: true,
      data: history,
    });
  },

  async clearHistory(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw createError("Authentication required", 401);
    }

    await chatbotService.clearHistory(userId);
    res.json({
      success: true,
      message: "Chatbot history cleared",
    });
  },

  async analytics(_req: Request, res: Response): Promise<void> {
    const analytics = await chatbotService.getAnalytics();
    res.json({
      success: true,
      data: analytics,
    });
  },
};

