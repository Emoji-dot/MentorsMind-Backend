import { logger } from "../utils/logger.utils";

const JAEGER_QUERY_URL =
  process.env.JAEGER_QUERY_URL ?? "http://localhost:16686/api/traces";

export interface JaegerTraceResponse {
  data: unknown[];
  total?: number;
}

/**
 * Queries the Jaeger query API for a full trace by its OpenTelemetry traceId.
 * Returns null if Jaeger is unreachable or the trace is not found.
 */
export const JaegerService = {
  async getTraceById(traceId: string): Promise<JaegerTraceResponse | null> {
    const url = `${JAEGER_QUERY_URL}/${traceId}`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        logger.warn("Jaeger query returned non-OK status", {
          traceId,
          status: response.status,
        });
        return null;
      }

      return (await response.json()) as JaegerTraceResponse;
    } catch (error) {
      logger.error("Failed to query Jaeger for trace", {
        traceId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  },
};
