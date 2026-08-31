import {
  ApiKeyModel,
  CreateApiKeyPayload,
  ApiKey,
  UsageStats,
  WebhookSubscription,
} from "../models/api-key.model";
import { createError } from "../middleware/errorHandler";

const VALID_SCOPES = [
  "bookings:read",
  "bookings:write",
  "sessions:read",
  "users:read",
  "mentors:read",
  "payments:read",
  "reviews:read",
  "webhooks:write",
];

const VALID_WEBHOOK_EVENTS = [
  "key.rotated",
  "key.revoked",
  "key.expiring_soon",
  "usage.threshold_exceeded",
  "usage.rate_limited",
];

export const ApiKeyService = {
  async create(
    userId: string,
    payload: Omit<CreateApiKeyPayload, "userId">,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const invalidScopes = payload.scopes.filter(
      (s) => !VALID_SCOPES.includes(s),
    );
    if (invalidScopes.length) {
      throw createError(`Invalid scopes: ${invalidScopes.join(", ")}`, 400);
    }
    return ApiKeyModel.create({ ...payload, userId });
  },

  async list(userId: string): Promise<ApiKey[]> {
    return ApiKeyModel.findByUser(userId);
  },

  async revoke(id: string, userId: string): Promise<void> {
    const revoked = await ApiKeyModel.revoke(id, userId);
    if (!revoked)
      throw createError("API key not found or not owned by user", 404);
  },

  listScopes(): string[] {
    return VALID_SCOPES;
  },

  async authenticate(rawKey: string) {
    return ApiKeyModel.authenticate(rawKey);
  },

  async rotate(
    id: string,
    userId: string,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const result = await ApiKeyModel.rotate(id, userId);
    if (!result)
      throw createError("API key not found or not owned by user", 404);
    return result;
  },

  async getUsage(id: string, userId: string): Promise<UsageStats> {
    const stats = await ApiKeyModel.getUsageStats(id, userId);
    if (!stats)
      throw createError("API key not found or not owned by user", 404);
    return stats;
  },

  listWebhookEvents(): string[] {
    return VALID_WEBHOOK_EVENTS;
  },

  async createWebhook(
    apiKeyId: string,
    userId: string,
    event: string,
    targetUrl: string,
  ): Promise<WebhookSubscription> {
    if (!VALID_WEBHOOK_EVENTS.includes(event)) {
      throw createError(
        `Invalid event. Must be one of: ${VALID_WEBHOOK_EVENTS.join(", ")}`,
        400,
      );
    }
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      throw createError("target_url must be a valid http(s) URL", 400);
    }
    const sub = await ApiKeyModel.createWebhookSubscription(
      apiKeyId,
      userId,
      event,
      targetUrl,
    );
    if (!sub) throw createError("API key not found or not owned by user", 404);
    return sub;
  },

  async listWebhooks(
    apiKeyId: string,
    userId: string,
  ): Promise<WebhookSubscription[]> {
    const subs = await ApiKeyModel.listWebhookSubscriptions(apiKeyId, userId);
    if (!subs) throw createError("API key not found or not owned by user", 404);
    return subs;
  },

  async deleteWebhook(
    id: string,
    apiKeyId: string,
    userId: string,
  ): Promise<void> {
    const deleted = await ApiKeyModel.deleteWebhookSubscription(
      id,
      apiKeyId,
      userId,
    );
    if (!deleted)
      throw createError("Webhook subscription not found or not owned by user", 404);
  },
};
