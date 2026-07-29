/**
 * API Versioning & Deprecation Management Middleware
 *
 * Implements comprehensive versioning strategy with:
 * - VersionInfo per API version (status, deprecatedAt, sunsetAt, migrationGuide, breakingChanges)
 * - Deprecation / Sunset / Link response headers (RFC 8594)
 * - Sunset enforcement (410 Gone)
 * - Version compatibility matrix
 * - Usage analytics per version
 */

import { Request, Response, NextFunction } from "express";

export interface VersionInfo {
  version: string;
  status: "current" | "deprecated" | "sunset";
  deprecatedAt?: Date;
  sunsetAt?: Date;
  migrationGuide?: string;
  breakingChanges?: string[];
}

export interface VersionCompatibility {
  from: string;
  to: string;
  compatible: boolean;
  notes?: string;
}

// ─── Version Registry ────────────────────────────────────────────────────────

const VERSION_REGISTRY: Record<string, VersionInfo> = {
  v1: {
    version: "v1",
    status: "deprecated",
    deprecatedAt: new Date("2027-01-01T00:00:00Z"),
    sunsetAt: new Date("2027-07-01T00:00:00Z"),
    migrationGuide: "https://api.mentorminds.com/migration/v1-to-v2",
    breakingChanges: [
      "Pagination now uses cursor-based instead of offset-based",
      "Error response shape changed to { error: { code, message } }",
      "Date fields now return ISO 8601 strings",
    ],
  },
  v2: {
    version: "v2",
    status: "current",
  },
};

/** Compatibility matrix between API versions */
export const COMPATIBILITY_MATRIX: VersionCompatibility[] = [
  {
    from: "v1",
    to: "v2",
    compatible: false,
    notes: "Breaking changes in pagination and error shapes",
  },
];

// ─── In-memory analytics (replace with persistent store in production) ───────

const versionUsageCount: Record<string, number> = {};

export function getVersionAnalytics(): Record<string, number> {
  return { ...versionUsageCount };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVersionFromPath(path: string): string | null {
  const match = path.match(/\/api\/(v\d+)/);
  return match ? match[1] : null;
}

function resolveVersion(req: Request): string {
  return (
    extractVersionFromPath(req.path) ??
    (req.headers["accept-version"] as string | undefined)?.toLowerCase() ??
    "v2"
  );
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * apiVersioningMiddleware
 *
 * Attaches version headers, enforces sunset, and tracks usage.
 * Mount globally before routes:
 *   app.use(apiVersioningMiddleware);
 */
export function apiVersioningMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const version = resolveVersion(req);
  const info: VersionInfo | undefined = VERSION_REGISTRY[version];

  // Unknown version → 404
  if (!info) {
    res.status(404).json({
      success: false,
      error: `API version '${version}' is not supported`,
      supportedVersions: Object.keys(VERSION_REGISTRY),
    });
    return;
  }

  // Track usage
  versionUsageCount[version] = (versionUsageCount[version] ?? 0) + 1;

  // Always expose the resolved version
  res.setHeader("X-API-Version", version);
  res.setHeader(
    "X-Supported-Versions",
    Object.keys(VERSION_REGISTRY).join(", "),
  );

  // Sunset enforcement — version is no longer available
  if (
    info.status === "sunset" &&
    info.sunsetAt &&
    new Date() >= info.sunsetAt
  ) {
    res.status(410).json({
      success: false,
      error: `API version '${version}' has been sunset as of ${info.sunsetAt.toUTCString()}`,
      migrationGuide: info.migrationGuide,
    });
    return;
  }

  // Deprecation headers (RFC 8594)
  if (info.status === "deprecated" || info.status === "sunset") {
    if (info.deprecatedAt) {
      res.setHeader("Deprecation", info.deprecatedAt.toUTCString());
    }
    if (info.sunsetAt) {
      res.setHeader("Sunset", info.sunsetAt.toUTCString());
    }
    if (info.migrationGuide) {
      res.setHeader(
        "Link",
        `<${info.migrationGuide}>; rel="successor-version"`,
      );
    }
    if (info.breakingChanges?.length) {
      res.setHeader("X-Breaking-Changes", info.breakingChanges.join(" | "));
    }
  }

  // Attach resolved info to request for downstream use
  (req as Request & { versionInfo: VersionInfo }).versionInfo = info;

  next();
}

// ─── Utility: get info for a specific version ────────────────────────────────

export function getVersionInfo(version: string): VersionInfo | undefined {
  return VERSION_REGISTRY[version];
}

export function getAllVersions(): VersionInfo[] {
  return Object.values(VERSION_REGISTRY);
}
