import { Router } from "express";
import { ChatbotController } from "../controllers/chatbot.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

router.use(authenticate);

router.post("/", asyncHandler(ChatbotController.chat));
router.get("/history", asyncHandler(ChatbotController.history));
router.delete("/history", asyncHandler(ChatbotController.clearHistory));
router.get("/analytics", asyncHandler(ChatbotController.analytics));

export default router;

