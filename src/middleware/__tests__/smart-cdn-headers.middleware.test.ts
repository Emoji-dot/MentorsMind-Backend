/**
 * Unit tests for SmartCdnHeaders middleware and CDNGeoConfig — Issue #745
 */

import { Request, Response, NextFunction } from "express";
import {
  CDNGeoConfig,
  buildCacheControlHeader,
  buildVaryHeader,
  buildSurrogateControlHeader,
  getApiCacheStrategy,
  CACHE_STRATEGIES,
} from "../../config/cdn-geo.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResMock() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }),
    send: jest.fn(),
    json: jest.fn(),
    _headers: headers,
  } as unknown as Response;
  return { res, headers };
}

function makeReqMock(path: string, method = "GET", hasAuth = false): Request {
  return {
    path,
    method,
    originalUrl: path,
    headers: hasAuth ? { authorization: "Bearer token" } : {},
    user: hasAuth ? { userId: "user-1" } : undefined,
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// buildCacheControlHeader
// ---------------------------------------------------------------------------

describe("buildCacheControlHeader", () => {
  it("returns no-store for noCache strategy", () => {
    expect(buildCacheControlHeader(CACHE_STRATEGIES["noCache"])).toBe("no-store");
  });

  it("returns private, no-cache for apiAuthenticated strategy", () => {
    expect(buildCacheControlHeader(CACHE_STRATEGIES["apiAuthenticated"])).toBe(
      "private, no-cache"
    );
  });

  it("includes max-age for public strategies", () => {
    const header = buildCacheControlHeader(CACHE_STRATEGIES["apiPublic"]);
    expect(header).toContain("public");
    expect(header).toContain("max-age=60");
  });

  it("includes stale-while-revalidate when set", () => {
    const header = buildCacheControlHeader(CACHE_STRATEGIES["apiListings"]);
    expect(header).toContain("stale-while-revalidate=120");
  });

  it("includes stale-if-error when set", () => {
    const header = buildCacheControlHeader(CACHE_STRATEGIES["images"]);
    expect(header).toContain("stale-if-error=3600");
  });

  it("static immutable has 1 year max-age", () => {
    const header = buildCacheControlHeader(CACHE_STRATEGIES["staticImmutable"]);
    expect(header).toContain("max-age=31536000");
  });
});

// ---------------------------------------------------------------------------
// buildVaryHeader
// ---------------------------------------------------------------------------

describe("buildVaryHeader", () => {
  it("returns null for strategies with no vary", () => {
    expect(buildVaryHeader(CACHE_STRATEGIES["apiAuthenticated"])).toBeNull();
  });

  it("returns Accept-Encoding for static strategy", () => {
    const vary = buildVaryHeader(CACHE_STRATEGIES["static"]);
    expect(vary).toContain("Accept-Encoding");
  });

  it("returns Accept and Accept-Encoding for images", () => {
    const vary = buildVaryHeader(CACHE_STRATEGIES["images"]);
    expect(vary).toContain("Accept");
    expect(vary).toContain("Accept-Encoding");
  });
});

// ---------------------------------------------------------------------------
// buildSurrogateControlHeader
// ---------------------------------------------------------------------------

describe("buildSurrogateControlHeader", () => {
  it("returns null for private strategy", () => {
    expect(buildSurrogateControlHeader(CACHE_STRATEGIES["apiAuthenticated"])).toBeNull();
  });

  it("returns null when surrogateMaxAge is not set", () => {
    expect(buildSurrogateControlHeader(CACHE_STRATEGIES["staticImmutable"])).toBeNull();
  });

  it("returns max-age when surrogateMaxAge is set", () => {
    const header = buildSurrogateControlHeader(CACHE_STRATEGIES["images"]);
    expect(header).toBe("max-age=604800");
  });

  it("api public listing has 5 min edge TTL", () => {
    const header = buildSurrogateControlHeader(CACHE_STRATEGIES["apiListings"]);
    expect(header).toBe("max-age=120");
  });
});

// ---------------------------------------------------------------------------
// getApiCacheStrategy
// ---------------------------------------------------------------------------

describe("getApiCacheStrategy", () => {
  it("health endpoint always returns noCache", () => {
    const strategy = getApiCacheStrategy("/health", "GET", false);
    expect(strategy.scope).toBe("no-store");
  });

  it("timezones endpoint is cacheable publicly", () => {
    const strategy = getApiCacheStrategy("/api/v1/timezones", "GET", false);
    expect(strategy.scope).toBe("public");
    expect(strategy.maxAge).toBeGreaterThan(0);
  });

  it("mentor listings without auth returns apiListings strategy", () => {
    const strategy = getApiCacheStrategy("/api/v1/mentors", "GET", false);
    expect(strategy.scope).toBe("public");
    expect(strategy.maxAge).toBe(30);
  });

  it("mentor listings WITH auth returns apiAuthenticated (bypass CDN)", () => {
    const strategy = getApiCacheStrategy("/api/v1/mentors", "GET", true);
    expect(strategy.scope).toBe("private");
  });

  it("authenticated API routes return private, no-cache", () => {
    const strategy = getApiCacheStrategy("/api/v1/users/me", "GET", true);
    expect(strategy.scope).toBe("private");
  });

  it("POST requests return apiAuthenticated strategy", () => {
    const strategy = getApiCacheStrategy("/api/v1/bookings", "POST", true);
    expect(strategy.scope).toBe("private");
  });
});

// ---------------------------------------------------------------------------
// CloudFront config
// ---------------------------------------------------------------------------

describe("CDNGeoConfig.getCloudFrontConfig", () => {
  beforeEach(() => {
    process.env.CDN_CLOUDFRONT_DISTRIBUTION_ID = "E123ABC";
    process.env.AWS_REGION = "us-east-1";
  });

  afterEach(() => {
    delete process.env.CDN_CLOUDFRONT_DISTRIBUTION_ID;
  });

  it("returns config when distribution ID is set", () => {
    const config = CDNGeoConfig.getCloudFrontConfig();
    expect(config).not.toBeNull();
    expect(config!.distributionId).toBe("E123ABC");
  });

  it("includes /assets/emails/* behaviour", () => {
    const config = CDNGeoConfig.getCloudFrontConfig();
    const emailBehaviour = config!.cacheBehaviours.find(
      (b) => b.pathPattern === "/assets/emails/*"
    );
    expect(emailBehaviour).toBeDefined();
    expect(emailBehaviour!.defaultTTL).toBe(31_536_000);
  });

  it("includes /api/v1/mentors behaviour with query string forwarding", () => {
    const config = CDNGeoConfig.getCloudFrontConfig();
    const mentorBehaviour = config!.cacheBehaviours.find(
      (b) => b.pathPattern === "/api/v1/mentors"
    );
    expect(mentorBehaviour).toBeDefined();
    expect(mentorBehaviour!.queryStringKeys).toContain("page");
  });

  it("returns null when distribution ID is not set", () => {
    delete process.env.CDN_CLOUDFRONT_DISTRIBUTION_ID;
    const config = CDNGeoConfig.getCloudFrontConfig();
    expect(config).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cloudflare config
// ---------------------------------------------------------------------------

describe("CDNGeoConfig.getCloudflareConfig", () => {
  beforeEach(() => {
    process.env.CDN_CLOUDFLARE_ZONE_ID = "zone123";
  });

  afterEach(() => {
    delete process.env.CDN_CLOUDFLARE_ZONE_ID;
  });

  it("returns config when zone ID is set", () => {
    const config = CDNGeoConfig.getCloudflareConfig();
    expect(config).not.toBeNull();
    expect(config!.tieredCaching).toBe(true);
  });

  it("has a rule to bypass cache for Authorization header", () => {
    const config = CDNGeoConfig.getCloudflareConfig();
    const bypassRule = config!.cacheRules.find(
      (r) => r.cacheStatus === "bypass" && r.expression.includes("authorization")
    );
    expect(bypassRule).toBeDefined();
  });

  it("returns null when zone ID is not set", () => {
    delete process.env.CDN_CLOUDFLARE_ZONE_ID;
    expect(CDNGeoConfig.getCloudflareConfig()).toBeNull();
  });
});
