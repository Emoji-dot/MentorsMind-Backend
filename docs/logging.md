# Logging Guide

## Overview

MentorsMind-Backend uses [Pino](https://github.com/pinojs/pino) for high-performance structured JSON logging. Every request is automatically correlated with a unique **Correlation ID** (UUID v4) so that all log entries from the same HTTP request can be traced together.

---

## Log Levels

| Level | When to Use |
|-------|-------------|
| `error` | Unrecoverable errors, exceptions, failed operations |
| `warn` | Degraded behaviour, unexpected input, skipped operations |
| `info` | Normal application milestones (startup, request completed, etc.) |
| `debug` | Verbose diagnostic data, useful in development only |

Set the active level via the `LOG_LEVEL` environment variable (default: `info`).

---

## Importing the Logger

```typescript
import { logger } from './utils/logger';
```

### Basic Usage

```typescript
logger.info('User registered', { userId: '123', email: 'user@example.com' });
logger.warn('Rate limit approaching', { userId: '123', remaining: 5 });
logger.error('Payment failed', { userId: '123', error: err.message });
logger.debug('Executing SQL query', { sql, params });
```

---

### Correlation IDs

Every HTTP request gets `X-Request-Id` and `X-Correlation-Id` headers assigned by `tracing.middleware` (mounted early in `app.ts`).

- If the upstream caller provides `X-Correlation-Id`, it is preserved; otherwise a new UUID v4 is generated.
- The request-level `X-Request-Id` is always newly generated when missing.
- Both IDs are available anywhere in the async call chain via the `traceStore` (used by `logger` mixin).

Retrieving the correlation id or creating a child logger:

```typescript
import { withCorrelationId } from '../utils/logger';

const requestLogger = withCorrelationId(req.correlationId);
requestLogger.info('Processing request');
```

---

## Log Formats

| Environment | Format | Notes |
|------------|--------|-------|
| `development` | Pretty-printed, colorized | `YYYY-MM-DD HH:mm:ss [corrId] LEVEL: message {meta}` |
| `production` | JSON | Machine-parseable, one JSON object per line |
| `test` | Suppressed | Console transport is disabled; spy on `logger` methods in tests |

---

## Sensitive Field Redaction

The following keys are **automatically replaced with `[REDACTED]`** anywhere in the log metadata (recursively):

`password`, `token`, `secret`, `secretKey`, `authorization`, `refreshToken`, `apiKey`, `privateKey`

You **never** need to redact these manually. However, **do not** use these key names for non-sensitive data.

---

## Log Files (Production Only)

When `NODE_ENV=production`, the logger emits machine-parseable JSON by default (one JSON object per line). You can route these logs to your aggregator of choice (Filebeat/Fluentd, Logstash, or a hosted provider).

Recommended deployment options:

- ELK (Elasticsearch + Logstash + Kibana): ship the service stdout to a log collector (Filebeat/Logstash) and configure an index pattern such as `mentorminds-%{+yyyy.MM.dd}`.
- Datadog / New Relic: use their log ingestion agent or HTTP API to collect JSON lines from stdout.

Configuration knobs are available via environment variables (see `.env.example` and `src/config/env.ts`). If you enable `ELASTICSEARCH_ENABLED=true`, the app provides helpers and example index syncing scripts under `scripts/`.

---

## Request / Response Logging

`requestLoggerMiddleware` (in `request-logger.middleware.ts`) automatically logs:

- **Incoming request**: method, URL, IP, userAgent, correlationId
- **Outgoing response** (on `res.finish`): statusCode, durationMs, correlationId

Log level is selected by HTTP status:
- `2xx, 3xx` → `info`
- `4xx` → `warn`
- `5xx` → `error`

---

## Testing

Logger methods can be mocked in Jest:

```typescript
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
```

Run logging-related tests:

```bash
npx jest --testPathPattern="logger|correlation-id|request-logger" --verbose

---

**Advanced features implemented**

- Structured JSON logging with automatic redaction and PII masking (`src/utils/logger.ts`).
- AsyncLocalStorage-based trace propagation (`src/middleware/tracing.middleware.ts`).
- Request logger middleware using `pino-http` with correlation IDs (`src/middleware/request-logger.middleware.ts`).
- A sampling helper for high-volume events (`src/utils/log-sampler.ts`).

**Integration & operations guidance**

- Use Filebeat or Fluent Bit to tail container stdout and forward to Elasticsearch or Datadog.
- In Elasticsearch/Kibana, create index lifecycle policies (ILM) to set retention and rollover rules. Example policy: hot for 7 days, warm for 14 days, delete after 90 days.
- Configure alerting in Kibana or Datadog: create alerts on `error`/`fatal` rate increases, high latency (responseTimeMs), or specific monitored exceptions.

If you want, I can add optional sample Filebeat/Logstash config and an example Kibana dashboard template next.
```


---

## ELK Stack Integration (Issue #740)

### Components

| Component | File | Role |
|-----------|------|------|
| `ELKTransport` | `src/utils/elk-transport.ts` | Batches and ships Pino logs to Elasticsearch via `_bulk` API |
| `elkLoggingMiddleware` | `src/middleware/elk-logging.middleware.ts` | Captures per-request HTTP logs in ECS format |
| `elkErrorLoggingMiddleware` | `src/middleware/elk-logging.middleware.ts` | Forwards unhandled errors to Elasticsearch |
| `setup-elk-index-template.ts` | `scripts/setup-elk-index-template.ts` | One-time setup of ILM policy + index template |
| `filebeat.yml` | `docs/logging-examples/filebeat.yml` | Filebeat config for container stdout shipping |
| `logstash-pipeline.conf` | `docs/logging-examples/logstash-pipeline.conf` | Logstash pipeline for field normalisation |
| `kibana-dashboard.json` | `docs/logging-examples/kibana-dashboard.json` | Importable Kibana dashboard |

### Environment variables

```bash
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme
ELASTICSEARCH_API_KEY=          # alternative to username/password
ELASTICSEARCH_INDEX_PREFIX=mentorminds

# Batch transport tuning
ELK_BATCH_SIZE=100              # Documents per Elasticsearch _bulk request
ELK_FLUSH_INTERVAL_MS=5000      # Auto-flush every 5 seconds
ELK_MAX_RETRIES=3               # Retry on transient 5xx from Elasticsearch
```

### Setup (one-time)

```bash
# 1. Create ILM policy, index template, and initial write index
npm run elk:setup

# 2. Import the Kibana dashboard
# Kibana → Management → Saved Objects → Import → kibana-dashboard.json

# 3. (Optional) Start Filebeat to ship container stdout
filebeat -c docs/logging-examples/filebeat.yml -e
```

### Mounting middleware

```typescript
// src/app.ts
import { elkLoggingMiddleware, elkErrorLoggingMiddleware } from './middleware/elk-logging.middleware';

// After tracing + auth middleware:
app.use(elkLoggingMiddleware());

// After error handler:
app.use(errorHandler);
app.use(elkErrorLoggingMiddleware());
```

### Index naming

Logs are indexed to `mentorminds-logs-YYYY.MM.DD` daily rolling indices,
managed by the `mentorminds-logs-ilm-policy` ILM policy (hot→warm→cold→delete at 90 days).

### Log schema (ECS)

Every log document includes ECS core fields:

| Field | Type | Example |
|-------|------|---------|
| `@timestamp` | date | `2026-07-29T05:00:00.000Z` |
| `log.level` | keyword | `info`, `warn`, `error` |
| `message` | text | `GET /api/v1/mentors 200 45ms` |
| `service.name` | keyword | `mentorminds-backend` |
| `service.environment` | keyword | `production` |
| `http.request.method` | keyword | `GET` |
| `http.response.status_code` | short | `200` |
| `durationMs` | long | `45` |
| `requestId` | keyword | `req-uuid` |
| `correlationId` | keyword | `corr-uuid` |
| `trace.id` | keyword | `otel-trace-id` |
| `userId` | keyword | `user-uuid` |
| `client.ip` | ip | `1.2.3.4` |
