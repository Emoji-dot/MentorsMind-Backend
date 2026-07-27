import { Router, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import { swaggerOptions } from "../config/swagger";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  security?: unknown[];
  requestBody?: {
    content?: Record<string, { schema?: unknown; example?: unknown }>;
  };
  responses?: Record<string, unknown>;
}

const router = Router();

// Lazily build the spec once
let cachedSpec: Record<string, unknown> | null = null;
function getSpec(): Record<string, unknown> {
  if (!cachedSpec) {
    cachedSpec = swaggerJsdoc(swaggerOptions) as Record<string, unknown>;
  }
  return cachedSpec;
}

function getOperations(
  spec: Record<string, unknown>,
): Array<{ path: string; method: HttpMethod; operation: OpenApiOperation }> {
  const paths = (spec.paths as Record<string, Record<string, unknown>>) ?? {};
  const operations: Array<{ path: string; method: HttpMethod; operation: OpenApiOperation }> = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
      operations.push({ path, method: method as HttpMethod, operation: operation as OpenApiOperation });
    }
  }

  return operations;
}

/**
 * An operation counts as "documented" when it has a summary and at least one
 * declared response — the minimum needed for a third-party developer to
 * understand what the endpoint does and what it returns.
 */
function isDocumented(operation: OpenApiOperation): boolean {
  const hasSummary = !!operation.summary && operation.summary.trim().length > 0;
  const hasResponses = !!operation.responses && Object.keys(operation.responses).length > 0;
  return hasSummary && hasResponses;
}

function computeCoverage(spec: Record<string, unknown>): {
  totalEndpoints: number;
  documentedEndpoints: number;
  coveragePct: number;
} {
  const operations = getOperations(spec);
  const totalEndpoints = operations.length;
  const documentedEndpoints = operations.filter((o) => isDocumented(o.operation)).length;
  const coveragePct = totalEndpoints === 0
    ? 0
    : Math.round((documentedEndpoints / totalEndpoints) * 10000) / 100;

  return { totalEndpoints, documentedEndpoints, coveragePct };
}

/** Builds a Postman Collection v2.1 from the live OpenAPI spec. */
function buildPostmanCollection(spec: Record<string, unknown>): Record<string, unknown> {
  const info = (spec.info as { title?: string; version?: string; description?: string }) ?? {};
  const servers = (spec.servers as { url: string }[]) ?? [];
  const baseUrl = servers[0]?.url ?? "{{baseUrl}}";

  const folders = new Map<string, unknown[]>();

  for (const { path, method, operation } of getOperations(spec)) {
    const tag = operation.tags?.[0] ?? "Uncategorized";
    if (!folders.has(tag)) folders.set(tag, []);

    const urlPath = path.replace(/\{([^}]+)}/g, ":$1");
    const jsonBody = operation.requestBody?.content?.["application/json"];
    const hasBody = ["post", "put", "patch"].includes(method) && !!jsonBody;

    folders.get(tag)!.push({
      name: operation.summary || `${method.toUpperCase()} ${path}`,
      request: {
        method: method.toUpperCase(),
        header: [{ key: "Content-Type", value: "application/json" }],
        url: {
          raw: `${baseUrl}${urlPath}`,
          host: [baseUrl],
          path: urlPath.split("/").filter(Boolean),
        },
        ...(operation.security
          ? { auth: { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] } }
          : {}),
        ...(hasBody
          ? {
            body: {
              mode: "raw",
              raw: JSON.stringify(jsonBody?.example ?? {}, null, 2),
              options: { raw: { language: "json" } },
            },
          }
          : {}),
      },
    });
  }

  return {
    info: {
      name: info.title ?? "MentorMinds API",
      description: info.description ?? "",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: Array.from(folders.entries()).map(([tag, items]) => ({ name: tag, item: items })),
    variable: [
      { key: "baseUrl", value: baseUrl },
      { key: "accessToken", value: "" },
    ],
  };
}

/**
 * @swagger
 * /docs/portal:
 *   get:
 *     summary: API Documentation Portal
 *     description: Returns a structured overview of all API endpoints grouped by tag.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: API portal overview
 */
router.get("/portal", (_req: Request, res: Response) => {
  const spec = getSpec();
  const paths = (spec.paths as Record<string, Record<string, unknown>>) ?? {};
  const tags = (spec.tags as { name: string; description?: string }[]) ?? [];

  // Build grouped endpoint index
  const grouped: Record<
    string,
    { method: string; path: string; summary: string; operationId?: string }[]
  > = {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = operation as {
        tags?: string[];
        summary?: string;
        operationId?: string;
      };
      const opTags = op.tags ?? ["Uncategorized"];
      for (const tag of opTags) {
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? "",
          operationId: op.operationId,
        });
      }
    }
  }

  const tagMap = Object.fromEntries(
    tags.map((t) => [t.name, t.description ?? ""]),
  );

  const sections = Object.entries(grouped).map(([tag, endpoints]) => ({
    tag,
    description: tagMap[tag] ?? "",
    endpointCount: endpoints.length,
    endpoints,
  }));

  res.json({
    success: true,
    data: {
      title: (spec.info as { title?: string })?.title ?? "API",
      version: (spec.info as { version?: string })?.version ?? "1.0.0",
      totalEndpoints: Object.values(grouped).reduce(
        (sum, eps) => sum + eps.length,
        0,
      ),
      totalTags: sections.length,
      sections,
      links: {
        swaggerUi: "/api/v1/docs",
        openApiSpec: "/api/v1/docs/spec.json",
        openApi: "/api/v1/docs/openapi",
        postmanCollection: "/api/v1/docs/postman",
        changelog: "/api/v1/docs/changelog",
        sdkGuide: "/api/v1/docs/sdk-guide",
        coverage: "/api/v1/docs/health",
      },
    },
  });
});

/**
 * @swagger
 * /docs/changelog:
 *   get:
 *     summary: API Changelog
 *     description: Returns the API version history and breaking change log.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Changelog entries
 */
router.get("/changelog", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      currentVersion: "1.4.0",
      entries: [
        {
          version: "1.4.0",
          date: "2026-07-25",
          type: "minor",
          changes: [
            "Notifications worker (#782): per-channel delivery tracking, independent retry limits, and a dead-letter queue — a PUSH failure no longer causes duplicate EMAIL sends on retry",
            "Webhook delivery (#783): per-endpoint circuit breaker — a broken subscriber endpoint no longer delays delivery to healthy endpoints. GET /webhooks/:id now returns a circuit_breaker field (additive, non-breaking)",
            "API docs portal (#784): Postman collection generator, raw OpenAPI endpoint with content negotiation, documentation coverage metrics, and sandbox try-it-out mode",
            "CI (#785): OWASP ZAP baseline scan, npm audit gate, and automated security headers check",
          ],
        },
        {
          version: "1.0.0",
          date: "2026-01-01",
          type: "major",
          changes: [
            "Initial stable release",
            "Auth, Users, Mentors, Bookings, Payments, Wallets",
            "Stellar blockchain integration",
          ],
        },
        {
          version: "1.1.0",
          date: "2026-02-01",
          type: "minor",
          changes: [
            "Added Learning Path Builder",
            "Session milestone tracking",
            "Certification system",
          ],
        },
        {
          version: "1.2.0",
          date: "2026-03-01",
          type: "minor",
          changes: [
            "Advanced analytics dashboard",
            "Session recording and transcription",
            "Referral program",
          ],
        },
        {
          version: "1.3.0",
          date: "2026-04-01",
          type: "minor",
          changes: [
            "Session Quality Analytics with ML scoring (#538)",
            "Comprehensive API Documentation Portal (#537)",
            "Trend detection with linear regression",
            "Sentiment analysis for session feedback",
          ],
        },
      ],
    },
  });
});

/**
 * @swagger
 * /docs/sdk-guide:
 *   get:
 *     summary: SDK and Integration Guide
 *     description: Returns code examples and integration guidance for common use cases.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: SDK guide with code examples
 */
router.get("/sdk-guide", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      authentication: {
        description: "Obtain a JWT token and include it in all requests.",
        example: {
          language: "typescript",
          code: `// 1. Login
const { data } = await axios.post('/api/v1/auth/login', {
  email: 'user@example.com',
  password: 'SecurePass1',
});
const token = data.data.accessToken;

// 2. Use token in subsequent requests
const client = axios.create({
  baseURL: 'https://api.mentorminds.com/api/v1',
  headers: { Authorization: \`Bearer \${token}\` },
});`,
        },
      },
      sessionQualityAnalytics: {
        description:
          "Retrieve ML-based quality scores and trend analysis for sessions.",
        example: {
          language: "typescript",
          code: `// Get quality score for a session
const score = await client.get(\`/session-quality/sessions/\${sessionId}\`);
console.log(score.data.data.overallScore); // 0-100

// Get mentor quality trend (last 90 days)
const trend = await client.get(\`/session-quality/mentors/\${mentorId}/trend?days=90\`);
console.log(trend.data.data.trend); // "improving" | "declining" | "stable"

// Get actionable insights
const insights = await client.get(\`/session-quality/mentors/\${mentorId}/insights\`);
insights.data.data.forEach(i => console.log(i.type, i.title));`,
        },
      },
      pagination: {
        description: "All list endpoints support page/limit query parameters.",
        example: {
          language: "typescript",
          code: `const { data } = await client.get('/mentors', {
  params: { page: 1, limit: 20, sortOrder: 'desc' },
});
// data.meta: { page, limit, total, totalPages }`,
        },
      },
      errorHandling: {
        description: "All errors follow a consistent shape.",
        example: {
          language: "typescript",
          code: `try {
  await client.post('/bookings', payload);
} catch (err) {
  if (axios.isAxiosError(err)) {
    const { status, data } = err.response!;
    // data.success === false
    // data.error — human-readable message
    console.error(status, data.error);
  }
}`,
        },
      },
      rateLimiting: {
        description:
          "The API enforces rate limits. Check response headers for current usage.",
        headers: {
          "X-RateLimit-Limit": "Maximum requests per window",
          "X-RateLimit-Remaining": "Requests remaining in current window",
          "X-RateLimit-Reset": "Unix timestamp when the window resets",
        },
      },
      webhooks: {
        description:
          "Register a webhook URL to receive real-time event notifications.",
        events: [
          "booking.confirmed",
          "booking.cancelled",
          "session.completed",
          "payment.succeeded",
          "payment.failed",
          "review.submitted",
        ],
        example: {
          language: "typescript",
          code: `await client.post('/webhooks', {
  url: 'https://your-app.com/webhooks/mentorminds',
  events: ['booking.confirmed', 'session.completed'],
  secret: 'your-webhook-secret',
});`,
        },
      },
    },
  });
});

/**
 * @swagger
 * /docs/health-status:
 *   get:
 *     summary: API health and status summary
 *     description: Returns a quick summary of API availability and key metrics.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Health status
 */
router.get("/health-status", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: "operational",
      version: "1.0.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      endpoints: {
        total: Object.keys(
          (getSpec().paths as Record<string, unknown>) ?? {},
        ).length,
        documented: Object.keys(
          (getSpec().paths as Record<string, unknown>) ?? {},
        ).length,
      },
      links: {
        health: "/health/ready",
        metrics: "/metrics",
        docs: "/api/v1/docs",
      },
    },
  });
});

/**
 * @swagger
 * /docs/health:
 *   get:
 *     summary: API documentation coverage
 *     description: Returns how many documented endpoints exist versus the total route count, computed live from the OpenAPI spec (issue #784).
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Documentation coverage metrics
 */
router.get("/health", (_req: Request, res: Response) => {
  const coverage = computeCoverage(getSpec());
  res.json({ success: true, data: coverage });
});

/**
 * @swagger
 * /docs/openapi:
 *   get:
 *     summary: Raw OpenAPI 3.0 specification
 *     description: Serves the same specification as /docs/spec.json with explicit content negotiation on the Accept header (issue #784).
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: OpenAPI 3.0 document
 *       406:
 *         description: Requested representation is not available
 */
router.get("/openapi", (req: Request, res: Response) => {
  const accept = req.headers.accept ?? "*/*";
  const acceptsJson = accept.includes("*/*") || accept.includes("json");

  if (!acceptsJson) {
    res.status(406).json({
      success: false,
      error: "Only application/json (or application/vnd.oai.openapi+json) is supported by this endpoint",
    });
    return;
  }

  const wantsOpenApiMediaType = accept.includes("vnd.oai.openapi");
  // Serialize to a string first — Express's res.send() routes plain objects
  // through res.json(), which unconditionally resets Content-Type and would
  // clobber the negotiated media type set below.
  const body = JSON.stringify(getSpec());
  res.setHeader(
    "Content-Type",
    wantsOpenApiMediaType ? "application/vnd.oai.openapi+json;version=3.0" : "application/json",
  );
  res.send(body);
});

/**
 * @swagger
 * /docs/postman:
 *   get:
 *     summary: Postman Collection v2.1
 *     description: Generates a Postman Collection v2.1 covering every documented endpoint, for one-click import (issue #784).
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Postman collection JSON
 */
router.get("/postman", (_req: Request, res: Response) => {
  const collection = buildPostmanCollection(getSpec());
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="mentorminds-api.postman_collection.json"');
  res.json(collection);
});

export default router;
