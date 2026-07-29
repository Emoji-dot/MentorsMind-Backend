import { Router } from "express";
import { AvailabilityPredictionController } from "../controllers/availability-prediction.controller";

const router = Router();

router.get(
  "/mentors/:mentorId/availability/predictions",
  AvailabilityPredictionController.getPredictions,
);
router.get(
  "/mentors/:mentorId/availability/demand",
  AvailabilityPredictionController.getDemandForecast,
);
router.post(
  "/mentors/:mentorId/waitlist",
  AvailabilityPredictionController.addToWaitlist,
);
router.get(
  "/mentors/:mentorId/waitlist",
  AvailabilityPredictionController.getWaitlist,
);

export default router;
