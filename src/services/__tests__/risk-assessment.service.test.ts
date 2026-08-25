import { RiskAssessmentService } from "../risk-assessment.service";
import { AccessRiskModel } from "../../models/access-risk.model";
import { LoginAttemptsService } from "../loginAttempts.service";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../models/access-risk.model", () => ({
  AccessRiskModel: {
    record: jest.fn(),
    getRecentForUser: jest.fn(),
    countDistinctIpsSince: jest.fn(),
  },
}));

jest.mock("../loginAttempts.service", () => ({
  LoginAttemptsService: {
    getStatus: jest.fn(),
  },
}));

function makeReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    headers: { "user-agent": "jest-test-agent" },
    ip: "10.0.0.1",
    socket: { remoteAddress: "10.0.0.1" },
    originalUrl: "/api/v1/test",
    user: { id: "u1", userId: "u1", email: "user@example.com", role: "user" },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

describe("RiskAssessmentService.assess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AccessRiskModel.record as jest.Mock).mockResolvedValue(undefined);
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([]);
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(0);
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: false,
      permanent: false,
      attempts: 0,
      captchaRequired: false,
    });
  });

  it("returns a low score with no signals when there is no history and no failures", async () => {
    const result = await RiskAssessmentService.assess(makeReq());
    expect(result.score).toBe(0);
    expect(result.signals).toEqual([]);
    expect(AccessRiskModel.record).toHaveBeenCalled();
  });

  it("flags a new IP when the user has prior history from different IPs", async () => {
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([
      {
        id: "r1",
        user_id: "u1",
        ip_address: "192.168.1.1",
        user_agent: "old-agent",
        device_fingerprint: "old-fp",
        risk_score: 0,
        decision: "assessed",
        resource: "/x",
        created_at: new Date(),
      },
    ]);

    const result = await RiskAssessmentService.assess(makeReq());
    expect(result.signals.some((s) => s.startsWith("new-ip:"))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("adds risk for recent failed login attempts", async () => {
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: false,
      permanent: false,
      attempts: 4,
      captchaRequired: true,
    });

    const result = await RiskAssessmentService.assess(makeReq());
    expect(result.signals.some((s) => s.startsWith("recent-failed-logins:"))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("flags impossible travel when distinct IP count exceeds the threshold", async () => {
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(5);

    const result = await RiskAssessmentService.assess(makeReq());
    expect(result.signals.some((s) => s.startsWith("impossible-travel:"))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("caps the score at 100 even when many signals fire", async () => {
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([
      {
        id: "r1",
        user_id: "u1",
        ip_address: "192.168.1.1",
        user_agent: "old-agent",
        device_fingerprint: "totally-different-fingerprint",
        risk_score: 0,
        decision: "assessed",
        resource: "/x",
        created_at: new Date(),
      },
    ]);
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: true,
      permanent: false,
      attempts: 20,
      captchaRequired: true,
    });
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(10);

    const result = await RiskAssessmentService.assess(makeReq());
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns a zero score without querying when there is no authenticated user", async () => {
    const result = await RiskAssessmentService.assess(makeReq({ user: undefined }));
    expect(result.score).toBe(0);
    expect(AccessRiskModel.record).not.toHaveBeenCalled();
  });
});
