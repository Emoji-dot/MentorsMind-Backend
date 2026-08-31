jest.mock("../../models/api-key.model", () => ({
  ApiKeyModel: {
    create: jest.fn(),
    findByUser: jest.fn(),
    revoke: jest.fn(),
    authenticate: jest.fn(),
    rotate: jest.fn(),
    getUsageStats: jest.fn(),
    createWebhookSubscription: jest.fn(),
    listWebhookSubscriptions: jest.fn(),
    deleteWebhookSubscription: jest.fn(),
  },
}));

import { ApiKeyModel } from "../../models/api-key.model";
import { ApiKeyService } from "../api-key.service";

const rotate = ApiKeyModel.rotate as jest.Mock;
const getUsageStats = ApiKeyModel.getUsageStats as jest.Mock;
const createWebhookSubscription =
  ApiKeyModel.createWebhookSubscription as jest.Mock;
const listWebhookSubscriptions =
  ApiKeyModel.listWebhookSubscriptions as jest.Mock;
const deleteWebhookSubscription =
  ApiKeyModel.deleteWebhookSubscription as jest.Mock;

describe("ApiKeyService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rotate", () => {
    it("returns the rotated key with a fresh plain key", async () => {
      rotate.mockResolvedValueOnce({
        apiKey: { id: "key-1", name: "My Key", scopes: ["bookings:read"] },
        plainKey: "mm_newsecret",
      });

      const result = await ApiKeyService.rotate("key-1", "user-1");

      expect(rotate).toHaveBeenCalledWith("key-1", "user-1");
      expect(result.plainKey).toBe("mm_newsecret");
      expect(result.apiKey.id).toBe("key-1");
    });

    it("throws when the key is not found or not owned by the user", async () => {
      rotate.mockResolvedValueOnce(null);

      await expect(ApiKeyService.rotate("key-1", "user-1")).rejects.toThrow(
        /not found or not owned/i,
      );
    });
  });

  describe("getUsage", () => {
    it("returns aggregate usage stats", async () => {
      getUsageStats.mockResolvedValueOnce({
        total: 100,
        last24h: 10,
        last7d: 50,
        byStatusClass: [{ statusClass: "2xx", count: 90 }],
        byEndpoint: [{ endpoint: "/api/v1/bookings", method: "GET", count: 40 }],
      });

      const stats = await ApiKeyService.getUsage("key-1", "user-1");

      expect(getUsageStats).toHaveBeenCalledWith("key-1", "user-1");
      expect(stats.total).toBe(100);
      expect(stats.byStatusClass).toHaveLength(1);
    });

    it("throws on ownership failure", async () => {
      getUsageStats.mockResolvedValueOnce(null);

      await expect(
        ApiKeyService.getUsage("key-1", "not-owner"),
      ).rejects.toThrow(/not found or not owned/i);
    });
  });

  describe("webhooks", () => {
    it("creates a webhook subscription for a valid event", async () => {
      createWebhookSubscription.mockResolvedValueOnce({
        id: "wh-1",
        api_key_id: "key-1",
        event: "key.rotated",
        target_url: "https://example.com/hook",
        is_active: true,
      });

      const sub = await ApiKeyService.createWebhook(
        "key-1",
        "user-1",
        "key.rotated",
        "https://example.com/hook",
      );

      expect(sub.id).toBe("wh-1");
      expect(createWebhookSubscription).toHaveBeenCalledWith(
        "key-1",
        "user-1",
        "key.rotated",
        "https://example.com/hook",
      );
    });

    it("rejects an invalid event", async () => {
      await expect(
        ApiKeyService.createWebhook(
          "key-1",
          "user-1",
          "not.a.real.event",
          "https://example.com/hook",
        ),
      ).rejects.toThrow(/invalid event/i);
      expect(createWebhookSubscription).not.toHaveBeenCalled();
    });

    it("rejects an invalid target_url", async () => {
      await expect(
        ApiKeyService.createWebhook(
          "key-1",
          "user-1",
          "key.rotated",
          "not-a-url",
        ),
      ).rejects.toThrow(/valid http/i);
    });

    it("lists webhook subscriptions", async () => {
      listWebhookSubscriptions.mockResolvedValueOnce([
        { id: "wh-1", api_key_id: "key-1", event: "key.rotated" },
      ]);

      const subs = await ApiKeyService.listWebhooks("key-1", "user-1");
      expect(subs).toHaveLength(1);
    });

    it("throws on ownership failure when listing", async () => {
      listWebhookSubscriptions.mockResolvedValueOnce(null);

      await expect(
        ApiKeyService.listWebhooks("key-1", "not-owner"),
      ).rejects.toThrow(/not found or not owned/i);
    });

    it("deletes a webhook subscription", async () => {
      deleteWebhookSubscription.mockResolvedValueOnce(true);

      await expect(
        ApiKeyService.deleteWebhook("wh-1", "key-1", "user-1"),
      ).resolves.toBeUndefined();
    });

    it("throws when deleting a webhook that doesn't exist / isn't owned", async () => {
      deleteWebhookSubscription.mockResolvedValueOnce(false);

      await expect(
        ApiKeyService.deleteWebhook("wh-1", "key-1", "not-owner"),
      ).rejects.toThrow(/not found or not owned/i);
    });
  });
});
