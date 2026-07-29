jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    del: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock("../rate-limiter.service", () => ({
  RateLimiterService: {
    check: jest.fn(),
  },
}));

jest.mock("../verification.service", () => ({
  VerificationService: {
    getStatusByMentorId: jest.fn(),
  },
}));

jest.mock("../background-check.service", () => ({
  BackgroundCheckService: {
    getMentorBackgroundChecks: jest.fn(),
  },
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: {
    findByUserId: jest.fn(),
  },
}));

jest.mock("../socket.service", () => ({
  SocketService: {
    emitToRoom: jest.fn(),
  },
}));

import pool from "../../config/database";
import { CacheService } from "../cache.service";
import { RateLimiterService } from "../rate-limiter.service";
import { VerificationService } from "../verification.service";
import { WalletModel } from "../../models/wallet.model";
import { SocketService } from "../socket.service";
import { MentorOnboardingService } from "../mentor-onboarding.service";

const query = (pool as { query: jest.Mock }).query;
const rateLimitCheck = RateLimiterService.check as jest.Mock;
const verificationStatus = VerificationService.getStatusByMentorId as jest.Mock;
const findWallet = WalletModel.findByUserId as jest.Mock;
const cacheDel = CacheService.del as jest.Mock;
const emitToRoom = SocketService.emitToRoom as jest.Mock;

describe("MentorOnboardingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns unmet step and verification dependencies", async () => {
    jest
      .spyOn(MentorOnboardingService, "getStepDependencies")
      .mockResolvedValueOnce(["profile_setup"]);
    verificationStatus.mockResolvedValueOnce({ status: "pending" });

    const unmet = await MentorOnboardingService.getUnmetDependencies(
      "mentor-1",
      "identity_verification",
      [],
    );

    expect(unmet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dependency: "profile_setup" }),
        expect.objectContaining({ dependency: "identity_verification" }),
      ]),
    );
  });

  it("rejects completeStep with HTTP 422 details when prerequisites are missing", async () => {
    jest
      .spyOn(MentorOnboardingService, "getOnboarding")
      .mockResolvedValueOnce({
        id: "onb-1",
        mentorId: "mentor-1",
        status: "in_progress",
        currentStep: 2,
        totalSteps: 10,
        stepsCompleted: ["profile_setup"],
        startedAt: new Date(),
        completedAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    rateLimitCheck.mockResolvedValueOnce({
      allowed: true,
      current: 1,
      remaining: 9,
      resetTime: new Date(),
      limit: 10,
    });
    jest
      .spyOn(MentorOnboardingService, "getUnmetDependencies")
      .mockResolvedValueOnce([
        {
          dependency: "background_check",
          reason: 'A completed background check with result "clear" is required.',
        },
      ]);

    await expect(
      MentorOnboardingService.completeStep("mentor-1", "background_check"),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: {
        unmetDependencies: [
          expect.objectContaining({ dependency: "background_check" }),
        ],
      },
    });
  });

  it("emits an admin room event after a successful step completion", async () => {
    jest
      .spyOn(MentorOnboardingService, "getOnboarding")
      .mockResolvedValueOnce({
        id: "onb-1",
        mentorId: "mentor-1",
        status: "in_progress",
        currentStep: 2,
        totalSteps: 10,
        stepsCompleted: ["profile_setup"],
        startedAt: new Date(),
        completedAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    rateLimitCheck.mockResolvedValueOnce({
      allowed: true,
      current: 1,
      remaining: 9,
      resetTime: new Date(),
      limit: 10,
    });
    jest
      .spyOn(MentorOnboardingService, "getUnmetDependencies")
      .mockResolvedValueOnce([]);
    jest
      .spyOn(MentorOnboardingService, "trackAnalytics")
      .mockResolvedValue(undefined);
    jest
      .spyOn(MentorOnboardingService, "transformOnboarding")
      .mockImplementation((row: any) => row);

    query.mockResolvedValueOnce({
      rows: [
        {
          id: "onb-1",
          mentor_id: "mentor-1",
          status: "in_progress",
          current_step: 3,
          total_steps: 10,
          steps_completed: ["profile_setup", "identity_verification"],
          started_at: new Date(),
          completed_at: null,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    await MentorOnboardingService.completeStep(
      "mentor-1",
      "identity_verification",
    );

    expect(cacheDel).toHaveBeenCalledWith("onboarding:mentor-1");
    expect(emitToRoom).toHaveBeenCalledWith(
      "admin",
      "mentor:onboarding_step_completed",
      expect.objectContaining({
        mentorId: "mentor-1",
        stepId: "identity_verification",
      }),
    );
  });

  it("requires an active wallet before payment setup can complete", async () => {
    jest
      .spyOn(MentorOnboardingService, "getStepDependencies")
      .mockResolvedValueOnce(["pricing_setup"]);
    findWallet.mockResolvedValueOnce({ status: "inactive" });

    const unmet = await MentorOnboardingService.getUnmetDependencies(
      "mentor-1",
      "payment_setup",
      ["pricing_setup"],
    );

    expect(unmet).toEqual([
      expect.objectContaining({ dependency: "payment_setup" }),
    ]);
  });
});
