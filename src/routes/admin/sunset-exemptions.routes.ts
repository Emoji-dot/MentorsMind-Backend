/**
 * Sunset Exemption Routes
 *
 * Admin endpoints for granting, listing and revoking sunset exemptions
 * (users allowed past a version's sunsetAt date).
 *
 * Mounted at /admin/sunset-exemptions (unversioned on purpose — exemption
 * management must stay reachable even after versions are sunsetted).
 */

import { Router } from "express";
import { SunsetExemptionsController } from "../../controllers/sunset-exemptions.controller";

const router = Router();

router.get("/", SunsetExemptionsController.list);
router.post("/", SunsetExemptionsController.grant);
router.delete("/:userId/:apiVersion", SunsetExemptionsController.revoke);

export default router;
