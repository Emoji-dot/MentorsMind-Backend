/**
 * Item Response Theory (IRT) utilities — 1-Parameter Logistic (Rasch) model
 *
 * Rasch model probability of a correct response:
 *   P(correct | θ, β) = 1 / (1 + exp(-(θ - β)))
 *
 * where:
 *   θ  = learner ability estimate (logit scale, typically [-4, 4])
 *   β  = item difficulty parameter (logit scale, same range)
 */

export interface IRTResponse {
  correct: boolean;
  /** IRT β difficulty parameter for this question */
  difficulty: number;
}

const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 1e-6;
/** Prior: θ ~ N(0, 1) — regularises MLE when data is sparse */
const PRIOR_VARIANCE = 1.0;

/**
 * Rasch model: probability of a correct response.
 */
export function raschP(theta: number, beta: number): number {
  return 1 / (1 + Math.exp(-(theta - beta)));
}

/**
 * Estimate learner ability θ via penalised maximum-likelihood (MAP with a
 * N(0,1) prior) using Newton-Raphson iteration.
 *
 * Returns θ = 0 when there are no responses (cold start).
 */
export function computeAbility(responses: IRTResponse[]): number {
  if (responses.length === 0) return 0;

  // Edge cases: all correct / all wrong — MLE diverges, clamp to ±3
  const allCorrect = responses.every((r) => r.correct);
  const allWrong = responses.every((r) => !r.correct);
  if (allCorrect) return 3.0;
  if (allWrong) return -3.0;

  let theta = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let gradient = -theta / PRIOR_VARIANCE; // prior gradient
    let hessian = -1 / PRIOR_VARIANCE;      // prior hessian

    for (const r of responses) {
      const p = raschP(theta, r.difficulty);
      const q = 1 - p;
      // log-likelihood gradient: (observed - expected)
      gradient += (r.correct ? 1 : 0) - p;
      // second derivative (information): -p*q
      hessian -= p * q;
    }

    if (Math.abs(hessian) < 1e-10) break;
    const step = gradient / hessian;
    theta -= step;

    // Clamp to reasonable range
    theta = Math.max(-4, Math.min(4, theta));

    if (Math.abs(step) < CONVERGENCE_THRESHOLD) break;
  }

  return theta;
}

/**
 * Standard error of the ability estimate.
 *
 * SE(θ) = 1 / sqrt(Fisher information)
 * Fisher information = sum of P(θ,β) * Q(θ,β) across all items + prior
 */
export function computeSE(theta: number, responses: IRTResponse[]): number {
  let info = 1 / PRIOR_VARIANCE; // prior information
  for (const r of responses) {
    const p = raschP(theta, r.difficulty);
    info += p * (1 - p);
  }
  return info > 0 ? 1 / Math.sqrt(info) : 99;
}

/**
 * Select the next question from a pool of candidates using maximum-information
 * (closest difficulty to current θ, maximising Fisher information).
 *
 * Items already answered are excluded via the `answeredIds` set.
 */
export function selectNextQuestion<T extends { id: string; difficulty_parameter: number }>(
  theta: number,
  candidates: T[],
  answeredIds: Set<string>,
): T | null {
  const available = candidates.filter((q) => !answeredIds.has(q.id));
  if (available.length === 0) return null;

  // Pick question whose difficulty is closest to current θ (maximises info)
  return available.reduce((best, q) => {
    const bestDiff = Math.abs(best.difficulty_parameter - theta);
    const qDiff = Math.abs(q.difficulty_parameter - theta);
    return qDiff < bestDiff ? q : best;
  });
}

/**
 * Map IRT ability estimate θ to a 1-5 skill level.
 *
 * θ scale: [-4, 4]
 * Boundaries chosen so a "pass" at θ ≈ 0 maps to level 3.
 */
export function thetaToSkillLevel(theta: number): number {
  if (theta >= 2.0) return 5;
  if (theta >= 0.8) return 4;
  if (theta >= -0.5) return 3;
  if (theta >= -1.8) return 2;
  return 1;
}
