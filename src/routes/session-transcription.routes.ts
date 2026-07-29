import { Router } from "express";
import { SessionTranscriptionController } from "../controllers/session-transcription.controller";
import { validate } from "../middleware/validation.middleware";
import {
  sessionIdParamSchema,
  saveTranscriptSchema,
  updateTranscriptSchema,
  searchTranscriptsSchema,
  translationParamSchema,
  saveTranslationSchema,
} from "../validators/schemas/session-transcription.schemas";

const router = Router();

router.get(
  "/sessions/:sessionId/transcript",
  validate(sessionIdParamSchema),
  SessionTranscriptionController.getTranscript,
);
router.post(
  "/sessions/:sessionId/transcript",
  validate(saveTranscriptSchema),
  SessionTranscriptionController.saveTranscript,
);
router.patch(
  "/sessions/:sessionId/transcript",
  validate(updateTranscriptSchema),
  SessionTranscriptionController.updateTranscript,
);
router.get(
  "/transcripts/search",
  validate(searchTranscriptsSchema),
  SessionTranscriptionController.searchTranscripts,
);
router.post(
  "/sessions/:sessionId/transcript/translations/:language",
  validate(saveTranslationSchema),
  SessionTranscriptionController.saveTranslation,
);
router.get(
  "/sessions/:sessionId/transcript/translations/:language",
  validate(translationParamSchema),
  SessionTranscriptionController.getTranslation,
);

export default router;
