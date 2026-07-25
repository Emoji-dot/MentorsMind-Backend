import { BackgroundCheck } from "../../models/certification.model";

export type BackgroundCheckStatus = "pending" | "in_progress" | "completed" | "failed";
export type BackgroundCheckResult = "clear" | "consider" | "suspended";

export interface BackgroundCheckAdapterResult {
  status: BackgroundCheckStatus;
  result?: BackgroundCheckResult;
  raw?: Record<string, unknown>;
}

export interface InitiatedBackgroundCheck {
  externalReferenceId: string;
  raw?: Record<string, unknown>;
}

export interface BackgroundCheckAdapter {
  initiateCheck(
    mentorId: string,
    checkType: BackgroundCheck["checkType"],
  ): Promise<InitiatedBackgroundCheck>;

  getCheckResult(externalReferenceId: string): Promise<BackgroundCheckAdapterResult>;
}

