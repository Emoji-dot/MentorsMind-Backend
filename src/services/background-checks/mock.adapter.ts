import {
  BackgroundCheckAdapter,
  BackgroundCheckAdapterResult,
  InitiatedBackgroundCheck,
} from "./background-check.adapter";
import { BackgroundCheck } from "../../models/certification.model";

export class MockBackgroundCheckAdapter implements BackgroundCheckAdapter {
  async initiateCheck(
    mentorId: string,
    checkType: BackgroundCheck["checkType"],
  ): Promise<InitiatedBackgroundCheck> {
    return {
      externalReferenceId: `mock-${mentorId}-${checkType}-${Date.now()}`,
      raw: { provider: "mock", checkType },
    };
  }

  async getCheckResult(externalReferenceId: string): Promise<BackgroundCheckAdapterResult> {
    const configured = (process.env.BACKGROUND_CHECK_MOCK_RESULT || "clear").toLowerCase();
    const result = configured === "consider" || configured === "suspended" ? configured : "clear";
    return {
      status: "completed",
      result,
      raw: { provider: "mock", externalReferenceId },
    };
  }
}

