/**
 * Unit tests for versioning.middleware sunset enforcement.
 */

jest.mock("../../services/sunset-exemption.service", () => ({
  SunsetExemptionService: { isExempt: jest.fn().mockResolvedValue(false) },
}));
jest.mock("../../config/metrics", () => ({
  deprecatedApiCallsTotal: { inc: jest.fn() },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config/api-versions.config", () => {
  // Mutable so individual tests can install the version state under test.
  const apiVersions: Record<string, unknown> = {};
  return {
    API_VERSIONS: apiVersions,
    __setVersions(values: Record<string, unknown>) {
      for (const key of Object.keys(apiVersions)) delete apiVersions[key];
      Object.assign(apiVersions, values);
    },
    CURRENT_VERSION: "v1",
    SUPPORTED_VERSIONS: ["v1", "v2"],
    SUNSET_WARNING_DAYS: 30,
  };
});

import { Request, Response, NextFunction } from "express";
import { versioningMiddleware } from "../versioning.middleware";
import { SunsetExemptionService } from "../../services/sunset-exemption.service";
import { deprecatedApiCallsTotal } from "../../config/metrics";
import * as versionsConfig from "../../config/api-versions.config";

const config = versionsConfig as unknown as {
  __setVersions: (values: Record<string, unknown>) => void;
};

interface RunResult {
  res: { status: jest.Mock; setHeader: jest.Mock; json: jest.Mock };
  next: NextFunction;
}

const runMiddleware = async (
  headers: Record<string, string> = {},
): Promise<RunResult> => {
  const req = { path: "/api/v1/users", headers } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn() as NextFunction;
  await versioningMiddleware(req, res as unknown as Response, next);
  return { res, next };
};

describe("versioningMiddleware — sunset enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 410 with API_VERSION_SUNSET body when sunsetAt has passed", async () => {
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: "2026-02-01T00:00:00Z",
        successorVersion: "v2",
        migrationGuide: "https://docs.mentorminds.com/api/migration/v1-to-v2",
      },
      v2: { version: "v2", active: true },
    });

    const { res, next } = await runMiddleware();

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "API_VERSION_SUNSET",
        message: expect.stringContaining("sunset on 2026-02-01T00:00:00.000Z"),
        migrationGuide: "https://docs.mentorminds.com/api/migration/v1-to-v2",
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(deprecatedApiCallsTotal.inc).toHaveBeenCalledWith({ version: "v1" });
  });

  test("exempt users bypass the sunset block and get X-Sunset-Exemption: active", async () => {
    (SunsetExemptionService.isExempt as jest.Mock).mockResolvedValueOnce(true);
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: "2026-02-01T00:00:00Z",
      },
    });

    const { res, next } = await runMiddleware({
      authorization: "Bearer valid-token",
    });

    expect(res.status).not.toHaveBeenCalledWith(410);
    expect(res.setHeader).toHaveBeenCalledWith("X-Sunset-Exemption", "active");
    expect(next).toHaveBeenCalled();
  });

  test("sets Warning 299 header within the 30-day window before sunsetAt", async () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: soon,
      },
    });

    const { res, next } = await runMiddleware();

    expect(res.status).not.toHaveBeenCalledWith(410);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Warning",
      `299 - "This API version will be sunset on ${soon}"`,
    );
    expect(next).toHaveBeenCalled();
  });

  test("does not set Warning header outside the 30-day window", async () => {
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: far,
      },
    });

    const { res } = await runMiddleware();

    expect(res.setHeader).not.toHaveBeenCalledWith(
      "Warning",
      expect.any(String),
    );
  });

  test("sets X-API-Deprecation-Date and X-API-Sunset-Date for deprecated versions", async () => {
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: "2027-06-01T00:00:00Z",
      },
    });

    const { res } = await runMiddleware();

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-API-Deprecation-Date",
      "2026-01-01T00:00:00Z",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-API-Sunset-Date",
      "2027-06-01T00:00:00Z",
    );
  });
});
