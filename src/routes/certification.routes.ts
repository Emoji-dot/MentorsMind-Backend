import { Router } from "express";
import { CertificationController } from "../controllers/certification.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole as authorize } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  getCertificationTypesSchema,
  createCertificationSchema,
  getMentorCertificationsSchema,
  getCertificationSummarySchema,
  updateCertificationSchema,
  verifyCertificationSchema,
  startSkillTestSchema,
  submitTestAnswersSchema,
  initiateBackgroundCheckSchema,
  getBackgroundCheckSchema,
  getOnboardingProgressSchema,
  completeOnboardingStepSchema,
} from "../validators/schemas/certification.schemas";

const router = Router();

// All certification routes require authentication
router.use(authenticate);

/**
 * Certification Types Routes
 */

// Get all certification types
// GET /api/v1/certifications/types
router.get(
  "/types",
  validate(getCertificationTypesSchema),
  CertificationController.getCertificationTypes,
);

/**
 * Certification Management Routes
 */

// Create certification request
// POST /api/v1/certifications
router.post(
  "/",
  authorize("mentor"),
  validate(createCertificationSchema),
  CertificationController.createCertification,
);

// Get mentor certifications
// GET /api/v1/certifications/mentor/:mentorId
router.get(
  "/mentor/:mentorId",
  authorize("mentor", "admin"),
  validate(getMentorCertificationsSchema),
  CertificationController.getMentorCertifications,
);

// Get certification summary
// GET /api/v1/certifications/mentor/:mentorId/summary
router.get(
  "/mentor/:mentorId/summary",
  validate(getCertificationSummarySchema),
  CertificationController.getCertificationSummary,
);

// Update certification (admin only)
// PUT /api/v1/certifications/:certificationId
router.put(
  "/:certificationId",
  authorize("admin"),
  validate(updateCertificationSchema),
  CertificationController.updateCertification,
);

// Verify certification (admin only)
// POST /api/v1/certifications/:certificationId/verify
router.post(
  "/:certificationId/verify",
  authorize("admin"),
  validate(verifyCertificationSchema),
  CertificationController.verifyCertification,
);

/**
 * Skill Test Routes
 */

// Start skill test
// POST /api/v1/certifications/tests/:testId/start
router.post(
  "/tests/:testId/start",
  authorize("mentor"),
  validate(startSkillTestSchema),
  CertificationController.startSkillTest,
);

// Submit test answers
// POST /api/v1/certifications/tests/attempts/:attemptId/submit
router.post(
  "/tests/attempts/:attemptId/submit",
  authorize("mentor"),
  validate(submitTestAnswersSchema),
  CertificationController.submitTestAnswers,
);

/**
 * Background Check Routes
 */

// Initiate background check
// POST /api/v1/certifications/background-checks
router.post(
  "/background-checks",
  authorize("mentor"),
  validate(initiateBackgroundCheckSchema),
  CertificationController.initiateBackgroundCheck,
);

// Get background check status
// GET /api/v1/certifications/background-checks/:checkId
router.get(
  "/background-checks/:checkId",
  authorize("mentor", "admin"),
  validate(getBackgroundCheckSchema),
  CertificationController.getBackgroundCheck,
);

/**
 * Onboarding Routes
 */

// Get onboarding progress
// GET /api/v1/certifications/onboarding/:mentorId
router.get(
  "/onboarding/:mentorId",
  authorize("mentor", "admin"),
  validate(getOnboardingProgressSchema),
  CertificationController.getOnboardingProgress,
);

// Complete onboarding step
// POST /api/v1/certifications/onboarding/:mentorId/steps/:stepId/complete
router.post(
  "/onboarding/:mentorId/steps/:stepId/complete",
  authorize("mentor"),
  validate(completeOnboardingStepSchema),
  CertificationController.completeOnboardingStep,
);

export default router;
