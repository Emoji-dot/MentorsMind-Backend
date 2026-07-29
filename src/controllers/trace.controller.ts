import { Request, Response } from "express";
import { JaegerService } from "../services/jaeger.service";
import { ResponseUtil } from "../utils/response.utils";

export const TraceController = {
  /** GET /api/v1/admin/trace/:traceId - Full trace lookup from Jaeger */
  async getTrace(req: Request, res: Response): Promise<void> {
    const traceId = req.params.traceId as string;

    const trace = await JaegerService.getTraceById(traceId);

    if (!trace) {
      ResponseUtil.error(res, "Trace not found", 404);
      return;
    }

    ResponseUtil.success(res, trace, "Trace retrieved successfully");
  },
};
