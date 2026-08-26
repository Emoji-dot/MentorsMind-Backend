/**
 * API Versioning Configuration
 *
 * Deprecation Policy:
 * - A minimum of 3 months notice is required before removing any API version.
 * - Deprecated versions will include `Deprecation`, `Sunset`,
 *   `X-API-Deprecation-Date` and `X-API-Sunset-Date` response headers.
 * - 30 days before `sunsetAt` every response carries a
 *   `Warning: 299 - "This API version will be sunset on {date}"` header.
 * - After `sunsetAt` passes the versioning middleware returns HTTP 410 Gone
 *   for the version, unless the caller holds an active sunset exemption.
 * - Consumers should migrate before the Sunset date to avoid service disruption.
 */

export interface VersionConfig {
  /** The version string, e.g. "v1" */
  version: string;
  /** Whether this version is currently active */
  active: boolean;
  /** ISO 8601 date when this version was deprecated (undefined = not deprecated) */
  deprecatedAt?: string;
  /** ISO 8601 date when this version will be removed (undefined = no planned removal) */
  sunsetAt?: string;
  /** Human-readable deprecation message */
  deprecationMessage?: string;
  /** URL of the migration guide for leaving this version */
  migrationGuide?: string;
  /** The version clients should migrate to when this one sunsets */
  successorVersion?: string;
}

export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    // Example of how to mark v1 as deprecated in the future:
    // deprecatedAt: '2026-06-01T00:00:00Z',
    // sunsetAt:     '2026-09-01T00:00:00Z',
    // deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
    migrationGuide: 'https://docs.mentorminds.com/api/migration/v1-to-v2',
    successorVersion: 'v2',
  },
  v2: {
    version: 'v2',
    active: true,
    migrationGuide: 'https://docs.mentorminds.com/api/migration/v2-to-v3',
    successorVersion: 'v3',
  },
};

/** The current default/latest stable version */
export const CURRENT_VERSION = 'v1';

/** Supported versions that can be requested via Accept-Version header */
export const SUPPORTED_VERSIONS = Object.values(API_VERSIONS)
  .filter((v) => v.active)
  .map((v) => v.version);

// ─── Sunset Exemptions ───────────────────────────────────────────────────────

/**
 * Number of days before `sunsetAt` at which clients start receiving the
 * RFC 7234 `Warning: 299` header on every response.
 */
export const SUNSET_WARNING_DAYS = 30;

/**
 * Static per-version sunset exemption allowlist.
 *
 * Lists user ids that may keep calling a version after its `sunsetAt` date
 * has passed (gradual sunset). Complemented at runtime by rows in the
 * `api_sunset_exemptions` table managed through the admin endpoints.
 *
 * Can be seeded via environment variables:
 *   API_SUNSET_EXEMPTIONS_V1="user-uuid-1,user-uuid-2"
 */
export const SUNSET_EXEMPT_USER_IDS: Record<string, readonly string[]> = {
  v1: parseExemptionEnv('API_SUNSET_EXEMPTIONS_V1'),
  v2: parseExemptionEnv('API_SUNSET_EXEMPTIONS_V2'),
};

function parseExemptionEnv(varName: string): readonly string[] {
  const raw = process.env[varName];
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Check whether a userId is statically exempt from sunset enforcement for a
 * version (env/config allowlist). Runtime exemptions live in
 * SunsetExemptionService — this helper only consults the static config.
 */
export function isStaticallySunsetExempt(
  version: string,
  userId?: string | null,
): boolean {
  if (!userId) return false;
  return (SUNSET_EXEMPT_USER_IDS[version] ?? []).includes(userId);
}

/** Resolve the successor version for a given version, if configured. */
export function getSuccessorVersion(version: string): VersionConfig | undefined {
  const cfg = API_VERSIONS[version];
  if (!cfg?.successorVersion) return undefined;
  return API_VERSIONS[cfg.successorVersion];
}
