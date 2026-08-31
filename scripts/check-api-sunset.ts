/**
 * API Sunset Gate (CI)
 *
 * Fails the build when the api-versions config is in an inconsistent sunset
 * state. Deploying with a past sunsetAt while no active successor version
 * exists would strand every consumer of that version with HTTP 410 and
 * nowhere to migrate.
 *
 * Failure conditions (exit 1):
 *   - A version's sunsetAt is in the past AND its configured successorVersion
 *     does not exist or is not marked `active: true`.
 *
 * Warning conditions (exit 0, printed to stderr):
 *   - A version's sunsetAt falls within the next 30 days.
 *
 * Usage: pnpm run sunset:check
 */

import {
  API_VERSIONS,
  SUNSET_WARNING_DAYS,
} from "../src/config/api-versions.config";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

const errors: string[] = [];
const warnings: string[] = [];

for (const version of Object.values(API_VERSIONS)) {
  if (!version.sunsetAt) continue;

  const sunsetMs = new Date(version.sunsetAt).getTime();
  if (Number.isNaN(sunsetMs)) {
    errors.push(
      `[${version.version}] sunsetAt '${version.sunsetAt}' is not a valid ISO 8601 date`,
    );
    continue;
  }

  const daysUntilSunset = Math.ceil((sunsetMs - now) / DAY_MS);
  const successor = version.successorVersion
    ? API_VERSIONS[version.successorVersion]
    : undefined;

  if (daysUntilSunset <= 0) {
    // Sunset already passed — a live successor must exist for clients to migrate to.
    if (!successor) {
      errors.push(
        `[${version.version}] sunsetAt (${version.sunsetAt}) has passed but successorVersion is not configured`,
      );
    } else if (!successor.active) {
      errors.push(
        `[${version.version}] sunsetAt (${version.sunsetAt}) has passed but successor version '${successor.version}' is not marked active: true`,
      );
    }
    // The runtime middleware enforces 410 regardless of this version's own
    // active flag, so leaving it active here is acceptable (gradual rollout).
  } else if (daysUntilSunset <= SUNSET_WARNING_DAYS) {
    warnings.push(
      `[${version.version}] sunsets in ${daysUntilSunset} day(s) on ${version.sunsetAt}`,
    );
    if (!successor?.active) {
      warnings.push(
        `[${version.version}] successor version '${version.successorVersion ?? "<none>"}' is missing or inactive — consumers will have nowhere to migrate`,
      );
    }
  }
}

if (warnings.length > 0) {
  for (const warning of warnings) {
    console.error(`WARNING: ${warning}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  console.error(
    "\nAPI sunset gate failed: resolve the above before deploying.",
  );
  process.exit(1);
}

console.log("API sunset gate passed: no sunset inconsistencies detected.");
process.exit(0);
