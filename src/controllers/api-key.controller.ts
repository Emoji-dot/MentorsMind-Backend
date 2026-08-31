import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { ApiKeyService } from "../services/api-key.service";

export const ApiKeyController = {
  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { name, scopes, rate_limit, description, expires_at } = req.body;

    const result = await ApiKeyService.create(userId, {
      name,
      scopes: scopes ?? [],
      rateLimit: rate_limit,
      description,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
    });

    // Plain key is shown only once
    res.status(201).json({
      success: true,
      data: {
        ...result.apiKey,
        key: result.plainKey,
      },
      message: "Store this key securely — it will not be shown again.",
    });
  },

  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const keys = await ApiKeyService.list(req.user!.userId);
    res.json({ success: true, data: keys });
  },

  async revoke(req: AuthenticatedRequest, res: Response): Promise<void> {
    await ApiKeyService.revoke(req.params.id as string, req.user!.userId);
    res.json({ success: true, message: "API key revoked" });
  },

  async listScopes(_req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: ApiKeyService.listScopes() });
  },

  async rotate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await ApiKeyService.rotate(
      req.params.id as string,
      req.user!.userId,
    );
    res.json({
      success: true,
      data: {
        ...result.apiKey,
        key: result.plainKey,
      },
      message: "Store this key securely — it will not be shown again.",
    });
  },

  async getUsage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stats = await ApiKeyService.getUsage(
      req.params.id as string,
      req.user!.userId,
    );
    res.json({ success: true, data: stats });
  },

  async createWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { event, target_url } = req.body;
    const sub = await ApiKeyService.createWebhook(
      req.params.id as string,
      req.user!.userId,
      event,
      target_url,
    );
    res.status(201).json({ success: true, data: sub });
  },

  async listWebhooks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const subs = await ApiKeyService.listWebhooks(
      req.params.id as string,
      req.user!.userId,
    );
    res.json({ success: true, data: subs });
  },

  async deleteWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
    await ApiKeyService.deleteWebhook(
      req.params.webhookId as string,
      req.params.id as string,
      req.user!.userId,
    );
    res.json({ success: true, message: "Webhook subscription deleted" });
  },
};
