import { Router } from 'express';
import { SessionSummaryController } from '../controllers/session-summary.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { validate } from '../middleware/validation.middleware';
import {
  bookingIdParamSchema,
  generateSummarySchema,
  sessionIdParamSchema,
  summaryIdParamSchema,
} from '../validators/schemas/session-summary.schemas';

const router = Router();

// All summary routes require authentication
router.use(authenticate);

// Generate a session summary for a booking
router.post(
  '/bookings/:bookingId/summaries',
  validate(generateSummarySchema),
  asyncHandler(SessionSummaryController.generateSummary),
);

// Get session summary by booking ID
router.get(
  '/bookings/:bookingId/summaries',
  validate(bookingIdParamSchema),
  asyncHandler(SessionSummaryController.getSummaryByBooking),
);

// Get session summary by session ID
router.get(
  '/sessions/:sessionId/summary',
  validate(sessionIdParamSchema),
  asyncHandler(SessionSummaryController.getSummaryBySession),
);

// Get session summary by ID
router.get(
  '/summaries/:id',
  validate(summaryIdParamSchema),
  asyncHandler(SessionSummaryController.getSummaryById),
);

// Get all summaries for the current user
router.get(
  '/summaries',
  asyncHandler(SessionSummaryController.getUserSummaries),
);

// Regenerate a session summary
router.post(
  '/summaries/:id/regenerate',
  validate(summaryIdParamSchema),
  asyncHandler(SessionSummaryController.regenerateSummary),
);

// Delete a session summary
router.delete(
  '/summaries/:id',
  validate(summaryIdParamSchema),
  asyncHandler(SessionSummaryController.deleteSummary),
);

export default router;
