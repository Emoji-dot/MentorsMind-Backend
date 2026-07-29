import axios, { AxiosInstance } from "axios";
import {
  BackgroundCheckAdapter,
  BackgroundCheckAdapterResult,
  InitiatedBackgroundCheck,
} from "./background-check.adapter";
import { BackgroundCheck } from "../../models/certification.model";

export class CheckrBackgroundCheckAdapter implements BackgroundCheckAdapter {
  private readonly client: AxiosInstance;
  private readonly packageSlug = process.env.CHECKR_PACKAGE || "basic_plus";

  constructor() {
    if (!process.env.CHECKR_API_KEY) {
      throw new Error("CHECKR_API_KEY is required when BACKGROUND_CHECK_PROVIDER=checkr");
    }

    this.client = axios.create({
      baseURL: process.env.CHECKR_BASE_URL || "https://api.checkr.com/v1",
      auth: {
        username: process.env.CHECKR_API_KEY,
        password: "",
      },
      timeout: Number(process.env.CHECKR_TIMEOUT_MS || 10000),
    });
  }

  async initiateCheck(
    mentorId: string,
    checkType: BackgroundCheck["checkType"],
  ): Promise<InitiatedBackgroundCheck> {
    const response = await this.withRetry(() =>
      this.client.post("/invitations", {
        package: this.packageSlug,
        work_locations: [{ country: "US" }],
        metadata: {
          mentorId,
          checkType,
        },
      }),
    );

    return {
      externalReferenceId: response.data?.id,
      raw: response.data,
    };
  }

  async getCheckResult(externalReferenceId: string): Promise<BackgroundCheckAdapterResult> {
    const response = await this.withRetry(() => this.client.get(`/invitations/${externalReferenceId}`));
    return {
      status: this.mapStatus(response.data?.status),
      result: this.mapResult(response.data?.result),
      raw: response.data,
    };
  }

  mapStatus(status?: string): BackgroundCheckAdapterResult["status"] {
    if (status === "complete" || status === "completed") return "completed";
    if (status === "pending") return "pending";
    if (status === "suspended" || status === "canceled" || status === "cancelled") return "failed";
    return "in_progress";
  }

  mapResult(result?: string): BackgroundCheckAdapterResult["result"] | undefined {
    if (result === "clear") return "clear";
    if (result === "consider") return "consider";
    if (result === "suspended") return "suspended";
    return undefined;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  }
}
