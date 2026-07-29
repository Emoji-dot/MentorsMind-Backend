import { Router } from "express";
import { ReferralController } from "../controllers/referral.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole as authorize } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  createReferralCodeSchema,
  referralCodeParamSchema,
  applyReferralCodeSchema,
  listUserReferralsSchema,
  referralStatsQuerySchema,
  referralIdParamSchema,
  updateReferralSchema,
  createAffiliateProfileSchema,
  affiliateUserIdParamSchema,
  updateAffiliateProfileSchema,
  requestPayoutSchema,
} from "../validators/schemas/referral.schemas";

const router = Router();

// All referral routes require authentication
router.use(authenticate);

/**
 * Referral Code Management Routes
 */

// Create referral code
// POST /api/v1/referrals/codes
router.post("/codes", validate(createReferralCodeSchema), ReferralController.createReferralCode);

// Get user's referral codes
// GET /api/v1/referrals/codes
router.get("/codes", ReferralController.getUserReferralCodes);

// Validate referral code
// GET /api/v1/referrals/codes/:code/validate
router.get(
  "/codes/:code/validate",
  validate(referralCodeParamSchema),
  ReferralController.validateReferralCode,
);

/**
 * Referral Tracking Routes
 */

// Apply referral code (create referral)
// POST /api/v1/referrals/apply
router.post("/apply", validate(applyReferralCodeSchema), ReferralController.applyReferralCode);

// Get user's referrals
// GET /api/v1/referrals
router.get("/", validate(listUserReferralsSchema), ReferralController.getUserReferrals);

// Get referral statistics
// GET /api/v1/referrals/stats
router.get("/stats", validate(referralStatsQuerySchema), ReferralController.getReferralStats);

// Update referral status (admin only)
// PUT /api/v1/referrals/:referralId
router.put(
  "/:referralId",
  authorize("admin"),
  validate(updateReferralSchema),
  ReferralController.updateReferral,
);

/**
 * Affiliate Program Routes
 */

// Create affiliate profile
// POST /api/v1/referrals/affiliate
router.post(
  "/affiliate",
  validate(createAffiliateProfileSchema),
  ReferralController.createAffiliateProfile,
);

// Get affiliate profile
// GET /api/v1/referrals/affiliate/:userId
router.get(
  "/affiliate/:userId",
  validate(affiliateUserIdParamSchema),
  ReferralController.getAffiliateProfile,
);

// Update affiliate profile
// PUT /api/v1/referrals/affiliate/:userId
router.put(
  "/affiliate/:userId",
  validate(updateAffiliateProfileSchema),
  ReferralController.updateAffiliateProfile,
);

// Get affiliate dashboard
// GET /api/v1/referrals/affiliate/:userId/dashboard
router.get(
  "/affiliate/:userId/dashboard",
  validate(affiliateUserIdParamSchema),
  ReferralController.getAffiliateDashboard,
);

// Approve affiliate profile (admin only)
// POST /api/v1/referrals/affiliate/:userId/approve
router.post(
  "/affiliate/:userId/approve",
  authorize("admin"),
  validate(affiliateUserIdParamSchema),
  ReferralController.approveAffiliateProfile,
);

/**
 * Reward Tier Routes
 */

// Get reward tiers
// GET /api/v1/referrals/tiers
router.get("/tiers", ReferralController.getRewardTiers);

/**
 * Payout Routes
 */

// Request payout (admin only for now)
// POST /api/v1/referrals/affiliate/:userId/payout
router.post(
  "/affiliate/:userId/payout",
  authorize("admin"),
  validate(requestPayoutSchema),
  ReferralController.requestPayout,
);

export default router;
