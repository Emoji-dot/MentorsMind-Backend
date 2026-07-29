/**
 * Geo-Distributed CDN Configuration — Issue #745
 *
 * Provides provider-specific CDN behaviour configuration for:
 *  - CloudFront (AWS)
 *  - Cloudflare
 *  - Fastly
 *
 * Covers three concerns from the issue:
 *  1. Geo-distributed CDN provider configuration (origins, edge locations, TTLs)
 *  2. Smart Cache-Control header strategy per content type
 *  3. API response caching rules for public endpoints
 */

import { env } from "./env";

// ---------------------------------------------------------------------------
// Cache strategy types
// ---------------------------------------------------------------------------

export type CacheScope = "public" | "private" | "no-store";

export interface CacheStrategy {
  /** Cache-Control max-age in seconds */
  maxAge: number;
  /** stale-while-revalidate in seconds (0 = omit) */
  staleWhileRevalidate?: number;
  /** stale-if-error in seconds (0 = omit) */
  staleIfError?: number;
  /** Whether to allow CDN edge caching */
  scope: CacheScope;
  /** Whether to vary on Accept-Encoding (gzip) */
  varyAcceptEncoding?: boolean;
  /** Whether to vary on Accept (for WebP image negotiation) */
  varyAccept?: boolean;
  /** Surrogate-Control TTL for Fastly / Varnish (separate from browser TTL) */
  surrogateMaxAge?: number;
  /** Cloudflare Cache-Control override directive */
  cfCacheTtl?: number;
}

// ---------------------------------------------------------------------------
// Default cache strategies per content category
// ---------------------------------------------------------------------------

export const CACHE_STRATEGIES: Record<string, CacheStrategy> = {
  // ── Static assets — long-lived, immutable after hash-rename
  staticImmutable: {
    maxAge: 31_536_000, // 1 year
    scope: "public",
    varyAcceptEncoding: true,
  },

  // ── Static assets — versioned but can change
  static: {
    maxAge: 2_592_000, // 30 days
    staleWhileRevalidate: 86_400,
    staleIfError: 86_400,
    scope: "public",
    varyAcceptEncoding: true,
  },

  // ── Images / media files
  images: {
    maxAge: 86_400, // 1 day
    staleWhileRevalidate: 3_600,
    staleIfError: 3_600,
    scope: "public",
    varyAcceptEncoding: true,
    varyAccept: true, // WebP negotiation
    surrogateMaxAge: 604_800, // 7 days on CDN edge
  },

  // ── Video files
  videos: {
    maxAge: 604_800, // 7 days
    staleWhileRevalidate: 86_400,
    staleIfError: 86_400,
    scope: "public",
    varyAcceptEncoding: false,
    surrogateMaxAge: 2_592_000, // 30 days on edge
  },

  // ── Public API responses — short TTL, good for listings
  apiPublic: {
    maxAge: 60, // 1 minute in browser
    staleWhileRevalidate: 300,
    staleIfError: 600,
    scope: "public",
    surrogateMaxAge: 300, // 5 min on CDN edge
    cfCacheTtl: 300,
  },

  // ── Mentor/learner listings — frequently updated
  apiListings: {
    maxAge: 30, // 30 seconds in browser
    staleWhileRevalidate: 120,
    staleIfError: 600,
    scope: "public",
    surrogateMaxAge: 120,
  },

  // ── Analytics / reporting — semi-static
  apiAnalytics: {
    maxAge: 300, // 5 minutes
    staleWhileRevalidate: 600,
    staleIfError: 3_600,
    scope: "public",
    surrogateMaxAge: 600,
  },

  // ── Authenticated user data — never cached by CDN
  apiAuthenticated: {
    maxAge: 0,
    scope: "private",
  },

  // ── No cache at all (e.g., POST/mutation responses, webhooks)
  noCache: {
    maxAge: 0,
    scope: "no-store",
  },
};

// ---------------------------------------------------------------------------
// CloudFront provider configuration
// ---------------------------------------------------------------------------

export interface CloudFrontConfig {
  distributionId: string;
  region: string;
  /** Default TTL for objects not explicitly assigned a cache policy */
  defaultTTL: number;
  /** Maximum TTL that CloudFront will cache an object */
  maxTTL: number;
  /** Minimum TTL for objects with Cache-Control: no-cache */
  minTTL: number;
  /** Cache behaviours mapped to path patterns */
  cacheBehaviours: CloudFrontCacheBehaviour[];
  /** Geo restriction config */
  geoRestriction?: {
    restrictionType: "whitelist" | "blacklist";
    locations: string[]; // ISO 3166-1 alpha-2 country codes
  };
  /** Compress objects automatically */
  compress: boolean;
  /** Enable HTTP/2 and HTTP/3 */
  httpVersions: Array<"http1.1" | "http2" | "http3">;
  /** Price class — controls which edge locations are used */
  priceClass: "PriceClass_100" | "PriceClass_200" | "PriceClass_All";
  /** Custom error page TTL for 4xx/5xx */
  customErrorTTL: number;
}

export interface CloudFrontCacheBehaviour {
  pathPattern: string;
  /** TTL in seconds */
  defaultTTL: number;
  maxTTL: number;
  minTTL: number;
  compress: boolean;
  allowedMethods: Array<"GET" | "HEAD" | "OPTIONS" | "PUT" | "POST" | "PATCH" | "DELETE">;
  cachedMethods: Array<"GET" | "HEAD" | "OPTIONS">;
  /** Query strings to forward / cache on */
  queryStringKeys?: string[];
  /** Headers to forward */
  headers?: string[];
  /** Forward cookies: none | whitelist | all */
  forwardCookies: "none" | "whitelist" | "all";
}

export function getCloudFrontConfig(): CloudFrontConfig | null {
  if (!env.CDN_CLOUDFRONT_DISTRIBUTION_ID) return null;

  return {
    distributionId: env.CDN_CLOUDFRONT_DISTRIBUTION_ID,
    region: env.AWS_REGION,
    defaultTTL: 86_400,
    maxTTL: 31_536_000,
    minTTL: 0,
    compress: true,
    httpVersions: ["http2", "http3"],
    priceClass: "PriceClass_All", // All edge locations worldwide
    customErrorTTL: 10,
    cacheBehaviours: [
      // Static assets — immutable
      {
        pathPattern: "/static/*",
        defaultTTL: 31_536_000,
        maxTTL: 31_536_000,
        minTTL: 0,
        compress: true,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
      },
      // Images
      {
        pathPattern: "/assets/images/*",
        defaultTTL: 86_400,
        maxTTL: 604_800,
        minTTL: 0,
        compress: false,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
        headers: ["Accept"], // WebP negotiation
      },
      // Videos
      {
        pathPattern: "/assets/videos/*",
        defaultTTL: 604_800,
        maxTTL: 2_592_000,
        minTTL: 0,
        compress: false,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
      },
      // Public API — mentor listings
      {
        pathPattern: "/api/v1/mentors",
        defaultTTL: 120,
        maxTTL: 300,
        minTTL: 0,
        compress: true,
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD", "OPTIONS"],
        queryStringKeys: ["page", "limit", "sort", "skill", "timezone"],
        forwardCookies: "none",
      },
      // Public API — timezone list (rarely changes)
      {
        pathPattern: "/api/v1/timezones",
        defaultTTL: 86_400,
        maxTTL: 604_800,
        minTTL: 0,
        compress: true,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
      },
      // Health check — never cache
      {
        pathPattern: "/health",
        defaultTTL: 0,
        maxTTL: 0,
        minTTL: 0,
        compress: false,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
      },
      // Email assets
      {
        pathPattern: "/assets/emails/*",
        defaultTTL: 31_536_000,
        maxTTL: 31_536_000,
        minTTL: 0,
        compress: false,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardCookies: "none",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cloudflare provider configuration
// ---------------------------------------------------------------------------

export interface CloudflareConfig {
  zoneId: string;
  /** Cache rules mapped to URL patterns */
  cacheRules: CloudflareCacheRule[];
  /** Tiered caching — use Cloudflare's Argo smart routing */
  tieredCaching: boolean;
  /** Purge by cache tag support */
  cacheTagsEnabled: boolean;
  /** Whether to use Cloudflare's image resizing (requires Business/Enterprise) */
  imageResizingEnabled: boolean;
  /** Minimum TTL the zone allows (depends on Cloudflare plan) */
  minTTL: number;
}

export interface CloudflareCacheRule {
  /** URL match expression (Cloudflare filter expression syntax) */
  expression: string;
  /** Edge TTL in seconds */
  edgeTTL: number;
  /** Browser TTL in seconds */
  browserTTL: number;
  /** Cache status: eligible | bypass | ignore */
  cacheStatus: "eligible" | "bypass" | "ignore";
}

export function getCloudflareConfig(): CloudflareConfig | null {
  if (!env.CDN_CLOUDFLARE_ZONE_ID) return null;

  return {
    zoneId: env.CDN_CLOUDFLARE_ZONE_ID,
    tieredCaching: true,
    cacheTagsEnabled: true,
    imageResizingEnabled: false, // Enable on Business/Enterprise plan
    minTTL: 0,
    cacheRules: [
      // Static assets — immutable
      {
        expression: '(http.request.uri.path matches "^/static/.*")',
        edgeTTL: 31_536_000,
        browserTTL: 31_536_000,
        cacheStatus: "eligible",
      },
      // Images
      {
        expression: '(http.request.uri.path matches "^/assets/images/.*")',
        edgeTTL: 604_800,
        browserTTL: 86_400,
        cacheStatus: "eligible",
      },
      // Email assets
      {
        expression: '(http.request.uri.path matches "^/assets/emails/.*")',
        edgeTTL: 31_536_000,
        browserTTL: 31_536_000,
        cacheStatus: "eligible",
      },
      // Public API mentor listings
      {
        expression:
          '(http.request.uri.path eq "/api/v1/mentors") and (http.request.method eq "GET")',
        edgeTTL: 120,
        browserTTL: 30,
        cacheStatus: "eligible",
      },
      // Authenticated requests — bypass cache
      {
        expression: '(http.request.headers["authorization"] ne "")',
        edgeTTL: 0,
        browserTTL: 0,
        cacheStatus: "bypass",
      },
      // Health check — bypass cache
      {
        expression: '(http.request.uri.path eq "/health")',
        edgeTTL: 0,
        browserTTL: 0,
        cacheStatus: "bypass",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Fastly provider configuration
// ---------------------------------------------------------------------------

export interface FastlyConfig {
  serviceId: string;
  /** Surrogate key groups for targeted purging */
  surrogateKeyGroups: Record<string, string[]>;
  /** VCL snippets for custom cache logic (human-readable descriptions only) */
  vcl: FastlyVclSnippet[];
}

export interface FastlyVclSnippet {
  name: string;
  type: "recv" | "pass" | "hit" | "miss" | "fetch" | "deliver" | "error";
  priority: number;
  /** VCL code snippet */
  content: string;
}

export function getFastlyConfig(): FastlyConfig | null {
  if (!env.CDN_FASTLY_SERVICE_ID) return null;

  return {
    serviceId: env.CDN_FASTLY_SERVICE_ID,
    surrogateKeyGroups: {
      "mentor-listings": ["mentor-*", "category-*"],
      "session-data": ["session-*", "booking-*"],
      "static-assets": ["static", "images", "emails"],
    },
    vcl: [
      {
        name: "recv-api-public-cache",
        type: "recv",
        priority: 100,
        content: `
          # Allow caching of public API GET requests without Authorization header
          if (req.method == "GET" && !req.http.Authorization &&
              req.url ~ "^/api/v1/(mentors|timezones)") {
            unset req.http.Cookie;
            return(hash);
          }
        `.trim(),
      },
      {
        name: "pass-authenticated",
        type: "recv",
        priority: 90,
        content: `
          # Pass (bypass cache) for authenticated requests
          if (req.http.Authorization) {
            return(pass);
          }
        `.trim(),
      },
      {
        name: "deliver-surrogate-keys",
        type: "deliver",
        priority: 100,
        content: `
          # Add surrogate keys based on path for targeted cache invalidation
          if (req.url ~ "^/assets/emails/") {
            set resp.http.Surrogate-Key = "static-assets emails";
          } elsif (req.url ~ "^/api/v1/mentors") {
            set resp.http.Surrogate-Key = "mentor-listings";
          }
        `.trim(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// API response cache header rules (public endpoints)
// ---------------------------------------------------------------------------

export interface ApiCacheRule {
  /** URL pattern (prefix match) */
  pathPrefix: string;
  /** HTTP methods this rule applies to */
  methods: string[];
  /** The cache strategy key from CACHE_STRATEGIES */
  strategy: keyof typeof CACHE_STRATEGIES;
  /** Whether authorization header bypass rule applies */
  bypassIfAuthenticated: boolean;
}

/**
 * Rules applied by SmartCacheHeadersMiddleware to set correct Cache-Control
 * headers on API responses. Earlier rules take precedence.
 */
export const API_CACHE_RULES: ApiCacheRule[] = [
  // Health check — no cache
  { pathPrefix: "/health", methods: ["GET"], strategy: "noCache", bypassIfAuthenticated: false },

  // Timezone list — very long TTL (rarely changes)
  { pathPrefix: "/api/v1/timezones", methods: ["GET"], strategy: "static", bypassIfAuthenticated: false },

  // Public mentor listings
  { pathPrefix: "/api/v1/mentors", methods: ["GET"], strategy: "apiListings", bypassIfAuthenticated: true },

  // Analytics — semi-static
  { pathPrefix: "/api/v1/analytics", methods: ["GET"], strategy: "apiAnalytics", bypassIfAuthenticated: true },

  // Platform health snapshots
  { pathPrefix: "/api/v1/platform-health", methods: ["GET"], strategy: "apiPublic", bypassIfAuthenticated: false },

  // All other authenticated routes — private, no CDN caching
  { pathPrefix: "/api/", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], strategy: "apiAuthenticated", bypassIfAuthenticated: false },
];

/**
 * Build a Cache-Control header value from a CacheStrategy.
 */
export function buildCacheControlHeader(strategy: CacheStrategy): string {
  const parts: string[] = [];

  if (strategy.scope === "no-store") return "no-store";
  if (strategy.scope === "private") return "private, no-cache";

  parts.push("public");
  parts.push(`max-age=${strategy.maxAge}`);

  if (strategy.staleWhileRevalidate) {
    parts.push(`stale-while-revalidate=${strategy.staleWhileRevalidate}`);
  }
  if (strategy.staleIfError) {
    parts.push(`stale-if-error=${strategy.staleIfError}`);
  }

  return parts.join(", ");
}

/**
 * Build a Vary header value from a CacheStrategy.
 */
export function buildVaryHeader(strategy: CacheStrategy): string | null {
  const vary: string[] = [];
  if (strategy.varyAcceptEncoding) vary.push("Accept-Encoding");
  if (strategy.varyAccept) vary.push("Accept");
  return vary.length > 0 ? vary.join(", ") : null;
}

/**
 * Build a Surrogate-Control header for Fastly/Varnish edge caches.
 * This allows a longer edge TTL than the browser Cache-Control TTL.
 */
export function buildSurrogateControlHeader(strategy: CacheStrategy): string | null {
  if (strategy.scope !== "public" || !strategy.surrogateMaxAge) return null;
  return `max-age=${strategy.surrogateMaxAge}`;
}

/**
 * Get the applicable cache strategy for an API path.
 * Returns the first matching rule, or apiAuthenticated if none matches.
 */
export function getApiCacheStrategy(
  path: string,
  method: string,
  hasAuthHeader: boolean,
): CacheStrategy {
  for (const rule of API_CACHE_RULES) {
    if (
      path.startsWith(rule.pathPrefix) &&
      rule.methods.includes(method.toUpperCase())
    ) {
      // If the rule is supposed to bypass when authenticated and request has auth
      if (rule.bypassIfAuthenticated && hasAuthHeader) {
        return CACHE_STRATEGIES["apiAuthenticated"];
      }
      return CACHE_STRATEGIES[rule.strategy];
    }
  }
  return CACHE_STRATEGIES["apiAuthenticated"];
}

// ---------------------------------------------------------------------------
// Combined config export
// ---------------------------------------------------------------------------

export const CDNGeoConfig = {
  CACHE_STRATEGIES,
  API_CACHE_RULES,
  getCloudFrontConfig,
  getCloudflareConfig,
  getFastlyConfig,
  buildCacheControlHeader,
  buildVaryHeader,
  buildSurrogateControlHeader,
  getApiCacheStrategy,
};
