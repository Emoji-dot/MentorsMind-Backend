/**
 * Elasticsearch Index Template Setup — Issue #740
 *
 * Creates an index template with ECS-compatible field mappings and an
 * Index Lifecycle Management (ILM) policy for the MentorsMind log indices.
 *
 * Run with:
 *   npx ts-node scripts/setup-elk-index-template.ts
 *
 * Prerequisites:
 *   - ELASTICSEARCH_URL set (and credentials if auth is enabled)
 *   - Elasticsearch 7.x or 8.x running
 */

import { env } from "../src/config/env";

const ES_URL = env.ELASTICSEARCH_URL.replace(/\/$/, "");
const INDEX_PREFIX = env.ELASTICSEARCH_INDEX_PREFIX || "mentorminds";

// ---------------------------------------------------------------------------
// Build auth headers
// ---------------------------------------------------------------------------

function buildAuthHeaders(): Record<string, string> {
  if (env.ELASTICSEARCH_API_KEY) {
    return { Authorization: `ApiKey ${env.ELASTICSEARCH_API_KEY}` };
  }
  if (env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD) {
    const creds = Buffer.from(
      `${env.ELASTICSEARCH_USERNAME}:${env.ELASTICSEARCH_PASSWORD}`,
    ).toString("base64");
    return { Authorization: `Basic ${creds}` };
  }
  return {};
}

// ---------------------------------------------------------------------------
// ILM policy
// ---------------------------------------------------------------------------

const ILM_POLICY = {
  policy: {
    phases: {
      hot: {
        min_age: "0ms",
        actions: {
          rollover: {
            max_primary_shard_size: "50gb",
            max_age: "1d",
          },
        },
      },
      warm: {
        min_age: "7d",
        actions: {
          shrink: { number_of_shards: 1 },
          forcemerge: { max_num_segments: 1 },
        },
      },
      cold: {
        min_age: "30d",
        actions: {
          freeze: {},
        },
      },
      delete: {
        min_age: "90d",
        actions: {
          delete: {},
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Index template with ECS field mappings
// ---------------------------------------------------------------------------

const INDEX_TEMPLATE = {
  index_patterns: [`${INDEX_PREFIX}-logs-*`],
  template: {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 1,
      "index.lifecycle.name": `${INDEX_PREFIX}-logs-ilm-policy`,
      "index.lifecycle.rollover_alias": `${INDEX_PREFIX}-logs`,
    },
    mappings: {
      dynamic: true,
      properties: {
        // ECS core
        "@timestamp": { type: "date" },
        "log.level": { type: "keyword" },
        message: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 1024 } } },

        // Service
        "service.name": { type: "keyword" },
        "service.version": { type: "keyword" },
        "service.environment": { type: "keyword" },

        // Host
        "host.name": { type: "keyword" },

        // HTTP request
        "http.request.method": { type: "keyword" },
        "http.request.url.path": { type: "keyword" },
        "url.full": { type: "keyword" },

        // HTTP response
        "http.response.status_code": { type: "short" },
        "http.response.body.bytes": { type: "long" },

        // Network / client
        "client.ip": { type: "ip" },
        "user_agent.original": { type: "keyword" },

        // Tracing
        "trace.id": { type: "keyword" },
        "span.id": { type: "keyword" },
        requestId: { type: "keyword" },
        correlationId: { type: "keyword" },

        // Application
        userId: { type: "keyword" },
        durationMs: { type: "long" },
        instanceId: { type: "keyword" },

        // Error fields
        "error.type": { type: "keyword" },
        "error.message": { type: "text" },
        "error.stack_trace": { type: "text" },
      },
    },
  },
  priority: 100,
  composed_of: [],
  _meta: {
    description: "MentorsMind structured log index template (ECS-compatible)",
    version: "1.0.0",
  },
};

// ---------------------------------------------------------------------------
// Bootstrap alias (initial write index)
// ---------------------------------------------------------------------------

async function esRequest(
  method: string,
  path: string,
  body?: object,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(),
  };
  const res = await fetch(`${ES_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let responseBody: unknown;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = null;
  }
  return { ok: res.ok, status: res.status, body: responseBody };
}

async function setup(): Promise<void> {
  console.log(`\n🔧  Setting up ELK index template for ${INDEX_PREFIX}…`);
  console.log(`    Elasticsearch: ${ES_URL}`);

  // 1. Create ILM policy
  console.log("\n[1/3] Creating ILM policy…");
  const ilmResult = await esRequest(
    "PUT",
    `/_ilm/policy/${INDEX_PREFIX}-logs-ilm-policy`,
    ILM_POLICY,
  );
  if (!ilmResult.ok) {
    console.error("    ✗ ILM policy failed:", ilmResult.status, JSON.stringify(ilmResult.body));
  } else {
    console.log("    ✓ ILM policy created");
  }

  // 2. Create index template
  console.log("\n[2/3] Creating index template…");
  const templateResult = await esRequest(
    "PUT",
    `/_index_template/${INDEX_PREFIX}-logs-template`,
    INDEX_TEMPLATE,
  );
  if (!templateResult.ok) {
    console.error("    ✗ Index template failed:", templateResult.status, JSON.stringify(templateResult.body));
  } else {
    console.log("    ✓ Index template created");
  }

  // 3. Bootstrap the initial write index (if it doesn't exist)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const initialIndex = `${INDEX_PREFIX}-logs-${today}-000001`;
  console.log(`\n[3/3] Bootstrapping initial index ${initialIndex}…`);
  const existsResult = await esRequest("HEAD", `/${initialIndex}`);
  if (existsResult.status === 200) {
    console.log("    ℹ  Index already exists, skipping");
  } else {
    const createResult = await esRequest("PUT", `/${initialIndex}`, {
      aliases: {
        [`${INDEX_PREFIX}-logs`]: {
          is_write_index: true,
        },
      },
    });
    if (!createResult.ok) {
      console.error("    ✗ Index creation failed:", createResult.status, JSON.stringify(createResult.body));
    } else {
      console.log("    ✓ Initial index created with write alias");
    }
  }

  console.log("\n✅  ELK setup complete.\n");
  console.log(`    Index alias:    ${INDEX_PREFIX}-logs`);
  console.log(`    ILM policy:     ${INDEX_PREFIX}-logs-ilm-policy`);
  console.log(`    Index template: ${INDEX_PREFIX}-logs-template`);
  console.log(`    Kibana pattern: ${INDEX_PREFIX}-logs-*\n`);
}

setup().catch((err) => {
  console.error("ELK setup failed:", err);
  process.exit(1);
});
