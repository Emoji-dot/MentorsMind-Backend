/**
 * ELK Log Aggregation Middleware — Issue #740
 *
 * Captures structured request/response log entries and forwards them to
 * the ELK transport for batched ingestion into Elasticsearch.
 *
 * Each entry includes:
 *  - ECS-standard fields (@timestamp, log.level, message, service.*, host.*)
 *  - HTTP request context (method, path, status, duration, client IP, user-agent)
 *  - Trace correlation (requestId, correlationId, traceId, spanId)
 *  - User context (userId) when available
 *
 * The middleware is designed to be lightweight — it delegates all I/O to the
 * ELKTransport batch queue and never blocks the request/response cycle.
 */

import { Request, Response, NextFunction } from "express";
import { getELKTransport, toECSDocument } from "../utils/elk-transport";
import { env } from "../config/env";

// ---------------------------------------------------------------------------
// ELK request logging middleware
// ---------------------------------------------------------------------------

/**
 * Mount this middleware AFTER tracing and auth middleware so that requestId,
 * correlationId, and userId are all available on the request object.
 *
 * @example
 * // src/app.ts
 * app.use(tracingMiddleware);
 * app.use(authenticate);
 * app.use(elkLoggingMiddleware());
 * app.use(router);
 */
export function elkLoggingMiddleware() {
  return function (req: Request, res: Response, next: NextFunction): void {
    const transport = getELKTransport();
    if (!transport) {
      // ELK disabled — no-op
      return next();
    }

    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      const status = res.statusCode;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

      const rawLog: Record<string, unknown> = {
        time: new Date().toISOString(),
        level,
        msg: `${req.method} ${req.originalUrl} ${status} ${durationMs}ms`,
        // HTTP fields
        "http.request.method": req.method,
        "http.request.url.path": req.path,
        "url.full": req.originalUrl,
        "http.response.status_code": status,
        "http.response.body.bytes": parseInt(
          res.getHeader("Content-Length") as string || "0",
          10,
        ) || 0,
        // Network
        "client.ip": extractClientIp(req),
        "user_agent.original": req.headers["user-agent"] ?? "",
        // Timing
        durationMs,
        // Correlation
        requestId: (req as any).requestId ?? (req as any).id,
        correlationId: (req as any).correlationId,
        traceId: (req as any).traceId,
        spanId: (req as any).spanId,
        // User
        userId: (req as any).user?.userId ?? (req as any).user?.id,
        // Service
        service: "mentorminds-backend",
        instanceId: env.INSTANCE_ID,
      };

      const doc = toECSDocument(rawLog);
      transport.write(doc);
    });

    next();
  };
}

// ---------------------------------------------------------------------------
// ELK error logging middleware
// ---------------------------------------------------------------------------

/**
 * Error handler that forwards unhandled exceptions to Elasticsearch as
 * error-level log documents before re-throwing to the next error handler.
 *
 * Mount this AFTER your primary error handler:
 *   app.use(errorHandler);
 *   app.use(elkErrorLoggingMiddleware());
 */
export function elkErrorLoggingMiddleware() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function (
    err: Error,
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const transport = getELKTransport();
    if (transport) {
      const rawLog: Record<string, unknown> = {
        time: new Date().toISOString(),
        level: "error",
        msg: err.message,
        "error.type": err.constructor.name,
        "error.message": err.message,
        "error.stack_trace": err.stack,
        "http.request.method": req.method,
        "http.request.url.path": req.path,
        requestId: (req as any).requestId,
        correlationId: (req as any).correlationId,
        userId: (req as any).user?.userId,
        service: "mentorminds-backend",
        instanceId: env.INSTANCE_ID,
      };
      transport.write(toECSDocument(rawLog));
    }
    next(err);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
