/**
 * Zero Trust Security Policies
 *
 * Plain, typed policy configuration for the zero-trust access-control layer.
 * No DB access here — this module is pure configuration so it can be unit
 * tested and reasoned about in isolation from the risk-assessment/policy
 * engine services that consume it.
 *
 * Part of issue #839 "Implement Zero Trust Security Model".
 */

// ─── Risk score bands ───────────────────────────────────────────────────────
//
// Risk scores are computed on a 0-100 scale by RiskAssessmentService.
// Bands are expressed as inclusive lower bounds; a score falls in a band
// when it is >= that band's `min` and < the next band's `min`.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_THRESHOLDS: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 30,
  HIGH: 60,
  CRITICAL: 85,
};

/** Resolve a numeric risk score (0-100) to a qualitative risk level. */
export function riskLevelForScore(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (score >= RISK_THRESHOLDS.HIGH) return "HIGH";
  if (score >= RISK_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

// ─── Resource sensitivity tiers ─────────────────────────────────────────────

export const RESOURCE_SENSITIVITY = {
  STANDARD: "standard",
  SENSITIVE: "sensitive",
  CRITICAL: "critical",
} as const;

export type ResourceSensitivity =
  (typeof RESOURCE_SENSITIVITY)[keyof typeof RESOURCE_SENSITIVITY];

export type ZeroTrustDecision = "allow" | "step_up_mfa" | "deny";

/**
 * Per-resource-sensitivity policy: maps a risk level to the decision that
 * should be taken for a request of that risk level accessing a resource of
 * that sensitivity tier.
 */
export type SensitivityPolicy = Record<RiskLevel, ZeroTrustDecision>;

export const DEFAULT_POLICIES: Record<ResourceSensitivity, SensitivityPolicy> = {
  // Everyday, low-value endpoints — only block on very high confidence of compromise.
  [RESOURCE_SENSITIVITY.STANDARD]: {
    LOW: "allow",
    MEDIUM: "allow",
    HIGH: "step_up_mfa",
    CRITICAL: "deny",
  },
  // Endpoints touching personal/financial data — step up earlier.
  [RESOURCE_SENSITIVITY.SENSITIVE]: {
    LOW: "allow",
    MEDIUM: "step_up_mfa",
    HIGH: "step_up_mfa",
    CRITICAL: "deny",
  },
  // Admin/high-blast-radius actions — deny outright once risk is high.
  [RESOURCE_SENSITIVITY.CRITICAL]: {
    LOW: "allow",
    MEDIUM: "step_up_mfa",
    HIGH: "deny",
    CRITICAL: "deny",
  },
};
