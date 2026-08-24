/**
 * Policy Engine Service
 *
 * Pure decision function mapping a computed risk score and a resource's
 * sensitivity tier to a zero-trust access decision, per the thresholds
 * defined in src/config/security-policies.ts.
 *
 * Part of issue #839 "Implement Zero Trust Security Model".
 */

import {
  DEFAULT_POLICIES,
  riskLevelForScore,
  ResourceSensitivity,
  ZeroTrustDecision,
} from "../config/security-policies";

export const PolicyEngineService = {
  /**
   * Evaluate the access decision for a given risk score and resource
   * sensitivity tier. Pure function — no I/O, fully deterministic.
   */
  evaluate(riskScore: number, resourceSensitivity: ResourceSensitivity): ZeroTrustDecision {
    const clamped = Math.max(0, Math.min(100, riskScore));
    const level = riskLevelForScore(clamped);
    const policy = DEFAULT_POLICIES[resourceSensitivity];
    return policy[level];
  },
};
