# CORS Configuration

This document explains how to configure and reason about the CORS policy enforced by `src/middleware/cors.middleware.ts`.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGIN` | Yes | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed origins. Supports plain URLs, glob-style wildcards, and `regex:` prefixes (see below). |
| `CORS_MAX_AGE` | No | `86400` | Preflight cache duration in seconds (`Access-Control-Max-Age`). Set to `0` to disable caching during local development. |

---

## Origin formats

Each comma-separated entry in `CORS_ORIGIN` can be one of three formats.

### 1. Plain URL (exact match)

```
CORS_ORIGIN=https://app.mentorminds.com,https://admin.mentorminds.com
```

The comparison is case-insensitive. The scheme and port must match exactly.

### 2. Glob-style wildcard

```
CORS_ORIGIN=https://*.mentorminds.com
```

The `*` matches exactly one subdomain segment (no dots). This allows:

- `https://app.mentorminds.com` ✅
- `https://admin.mentorminds.com` ✅

But blocks:

- `https://sub.app.mentorminds.com` ❌  (two levels deep)
- `https://evil.com` ❌
- `https://evil.com?x=https://app.mentorminds.com` ❌  (path injection)

The pattern is anchored (`^...$`) so it cannot be bypassed by appending path segments.

### 3. Explicit regex

For more complex patterns, prefix the value with `regex:`:

```
CORS_ORIGIN=regex:^https://[a-z]+-mentorminds\.com$
```

Use this sparingly — prefer plain URLs or glob wildcards. If you use a `regex:` entry, double-check that it is anchored (`^` and `$`) to avoid partial matches.

---

## Production safeguard

The server **refuses to start** if `NODE_ENV=production` and `CORS_ORIGIN` contains `*`. This prevents a misconfigured wildcard from silently allowing all websites to make authenticated cross-origin requests.

```
[FATAL] CORS misconfiguration: CORS_ORIGIN=* is not allowed in production.
Set CORS_ORIGIN to a comma-separated list of trusted origin URLs.
Example: CORS_ORIGIN=https://app.mentorminds.com,https://admin.mentorminds.com
```

The check is enforced in `validateCorsForEnvironment()` before any request is processed.

---

## Blocked origins

Origins that do not match any configured pattern receive a **HTTP 403** response. This gives the browser a clear, actionable error rather than a cryptic "no CORS headers" response.

---

## Allowed request headers

The following headers are accepted from browsers (sent in `Access-Control-Allow-Headers`):

| Header | Purpose |
|--------|---------|
| `Content-Type` | Request body format |
| `Authorization` | JWT bearer token |
| `X-Requested-With` | XHR indicator |
| `X-Request-ID` | Per-request tracing |
| `X-Trace-ID` | Distributed trace ID |
| `X-Correlation-ID` | Correlates requests across services |
| `Idempotency-Key` | Prevents duplicate mutations |
| `X-MFA-Code` | Second-factor authentication code |
| `X-Webhook-Signature` | Webhook payload integrity |
| `X-API-Key` | API key authentication |

---

## Exposed response headers

The following headers are readable by browser JavaScript (sent in `Access-Control-Expose-Headers`):

| Header | Purpose |
|--------|---------|
| `X-Total-Count` | Total records for pagination |
| `X-Page` | Current page number |
| `X-Per-Page` | Page size |
| `X-Request-ID` | Echo of the request trace ID |
| `X-Trace-ID` | Distributed trace ID |
| `X-Correlation-ID` | Correlation identifier |
| `X-Cache` | Cache hit/miss indicator |
| `X-RateLimit-Limit` | Request quota |
| `X-RateLimit-Remaining` | Remaining requests in current window |

---

## Examples

### Development (single app)

```env
CORS_ORIGIN=http://localhost:3000
CORS_MAX_AGE=0
```

### Development (multiple frontends)

```env
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

### Staging

```env
CORS_ORIGIN=https://staging.mentorminds.com,https://*.staging.mentorminds.com
```

### Production — single domain

```env
CORS_ORIGIN=https://app.mentorminds.com
CORS_MAX_AGE=86400
```

### Production — all subdomains

```env
CORS_ORIGIN=https://*.mentorminds.com
CORS_MAX_AGE=86400
```

### Production — mixed

```env
CORS_ORIGIN=https://app.mentorminds.com,https://admin.mentorminds.com,https://*.preview.mentorminds.com
CORS_MAX_AGE=86400
```

---

## Architecture notes

- The `corsMiddleware` singleton is created at module load time using `buildCorsMiddleware()`. Tests import `buildCorsMiddleware` directly to inject custom configurations without touching the singleton.
- The production guard runs inside `buildCorsMiddleware()`, so it fires both at server start (via the module-level singleton) and in tests that explicitly pass `nodeEnv: 'production'`.
- The `cors` npm package is used for the actual header writing. The custom origin callback handles matching; everything else (methods, headers, credentials) is managed by the package.

---

## Running CORS tests

```bash
npm run test:cors
```

The test suite (`src/middleware/__tests__/cors.middleware.test.ts`) uses the same lightweight harness as the validator tests. No additional dependencies required.
