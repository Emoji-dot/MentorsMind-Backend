// @ts-nocheck
import { Request, Response } from "express";
import { DisputeService } from "../services/disputes.service";
import { DisputeModel } from "../models/dispute.model";
import { routeParam } from "../utils/route-params.utils";
import { RESOLUTION_TEMPLATES } from "../constants/resolution-templates.constant";

export class DisputesController {
  static async openDispute(req: Request, res: Response): Promise<void> {
    try {
      const { session_id, type, reason } = req.body;
      const filed_by_id = (req as any).user!.userId || (req as any).user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      if (!session_id || !type || !reason) {
        res
          .status(400)
          .json({ error: "Session ID, type, and reason are required" });
        return;
      }

      const dispute = await DisputeService.openDispute(
        session_id,
        filed_by_id,
        type,
        reason,
        ipAddress,
        userAgent
      );
      res.status(201).json({ data: dispute });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getDispute(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const dispute = await DisputeModel.findById(id);

      if (!dispute) {
        res.status(404).json({ error: "Dispute not found" });
        return;
      }

      const evidence = await DisputeModel.getEvidence(id);
      res.status(200).json({ data: { ...dispute, evidence } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async uploadEvidence(req: Request, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      const { text_content, file_url } = req.body;
      const submitterId = (req as any).user!.userId || (req as any).user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";
      const userRole = (req as any).user!.role;

      const evidence = await DisputeService.uploadEvidence(
        id,
        submitterId,
        userRole,
        text_content,
        file_url,
        ipAddress,
        userAgent
      );
      res.status(201).json({ data: evidence });
    } catch (error: any) {
      if (error.message.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async resolveDispute(req: Request, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      const { mentor_pct, notes } = req.body;
      const adminId = (req as any).user!.userId || (req as any).user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      if (mentor_pct === undefined || mentor_pct < 0 || mentor_pct > 100) {
        res.status(400).json({ error: "Valid mentor_pct (0-100) is required" });
        return;
      }

      const dispute = await DisputeService.resolveDispute(
        id,
        adminId,
        mentor_pct,
        notes,
        ipAddress,
        userAgent
      );
      res.status(200).json({ data: dispute });
    } catch (error: any) {
      if (
        error.message.includes("Invalid state transition") ||
        error.message.includes("not found")
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async mediateDispute(req: Request, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      const { notes } = req.body;
      const adminId = (req as any).user!.userId || (req as any).user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const dispute = await DisputeService.mediateDispute(id, adminId, notes, ipAddress, userAgent);
      res.status(200).json({ data: dispute });
    } catch (error: any) {
      if (
        error.message.includes("Invalid state transition") ||
        error.message.includes("not found")
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async getResolutionTemplates(
    _req: Request,
    res: Response,
  ): Promise<void> {
    res.status(200).json({ data: RESOLUTION_TEMPLATES });
  }

  static async listDisputes(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user!.userId || (req as any).user!.id;
      const isAdmin = (req as any).user!.role === "admin";

      let disputes;
      if (isAdmin) {
        disputes = await DisputeModel.findAll();
      } else {
        disputes = await DisputeModel.findByUserId(userId);
      }

      res.status(200).json({ data: disputes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
