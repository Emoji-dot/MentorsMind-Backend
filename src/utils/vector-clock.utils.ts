/**
 * Vector clock utilities for offline-sync conflict detection.
 *
 * A vector clock is a map of deviceId -> logical timestamp. Comparing two
 * vector clocks tells you whether one causally happened-before the other,
 * or whether they are concurrent (i.e. a genuine conflict between devices).
 */

export type VectorClock = Record<string, number>;

// JS safely represents integers up to 2^53-1; clamp before that to leave headroom.
export const MAX_LOGICAL_TIMESTAMP = Number.MAX_SAFE_INTEGER - 1;

export type ClockComparison = "equal" | "before" | "after" | "concurrent";

/**
 * Compares vector clock `a` against `b` from a's perspective.
 *  - "equal": identical clocks
 *  - "before": a happened-before b (b is strictly newer on every device)
 *  - "after": a happened-after b (a is strictly newer on every device)
 *  - "concurrent": neither dominates — a genuine conflict
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): ClockComparison {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;

  for (const key of keys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && bGreater) return "concurrent";
  if (aGreater) return "after";
  if (bGreater) return "before";
  return "equal";
}

/**
 * Merges two vector clocks by taking the max logical timestamp per device.
 * Used after a conflict is resolved to produce the new server-side clock.
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };
  for (const [key, value] of Object.entries(b)) {
    merged[key] = Math.max(merged[key] ?? 0, value);
  }
  return merged;
}

/**
 * Increments the logical timestamp for a given device in a vector clock,
 * clamping at MAX_LOGICAL_TIMESTAMP to avoid overflow past Number.MAX_SAFE_INTEGER.
 */
export function incrementClock(clock: VectorClock, deviceId: string): VectorClock {
  const current = clock[deviceId] ?? 0;
  const next = current >= MAX_LOGICAL_TIMESTAMP ? MAX_LOGICAL_TIMESTAMP : current + 1;
  return { ...clock, [deviceId]: next };
}

export function isValidVectorClock(value: unknown): value is VectorClock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([k, v]) => typeof k === "string" && typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
}
