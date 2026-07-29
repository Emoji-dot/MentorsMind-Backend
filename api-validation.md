# API Input Validation

This document describes the input validation approach for the v1 API (issue #667).

## Pattern

Every route that accepts `body`, `query`, or `params` is validated with a
[Zod](https://zod.dev) schema through a single middleware factory:

```ts
import { validate } from "../middleware/validation.middleware";
import { createBookingSchema } from "../validators/schemas/bookings.schemas";

router.post("/", validate(createBookingSchema), asyncHandler(BookingsController.create));
```

`validate(schema)` runs `schema.safeParse({ body, query, params })`. On failure it
responds **HTTP 422** with a structured, field-level error list:

```json
{
  "success": false,
  "errors": [
    { "field": "body.topic", "message": "String must contain at most 500 character(s)", "code": "too_big" }
  ]
}
```

Schemas live in `src/validators/schemas/<domain>.schemas.ts`, one file per
domain (`admin`, `disputes`, `payments`, `bookings`, `users`, ...), and are
wired into the matching `src/routes/<domain>.routes.ts`.

## Shared primitives (`src/validators/schemas/common.schemas.ts`)

| Schema | Purpose |
|---|---|
| `uuidSchema` | Strict UUID v4 — used for every `:id` route param |
| `idParamSchema` | `{ params: { id: uuidSchema } }` shortcut |
| `paginationSchema` | `page`/`limit` (bounded, prevents integer overflow) + `sortBy`/`sortOrder` |
| `cursorPaginationSchema` | Cursor-based pagination variant |
| `emailSchema` / `passwordSchema` | Auth primitives |
| `stellarAddressSchema` / `stellarTxHashSchema` | Stellar G-address / tx hash format checks |
| `nameSchema` / `shortTextSchema` (≤500) / `longTextSchema` (≤2000) | Bounded text fields |
| `urlSchema` | http(s)-only URL |

Field length limits follow the issue's spec: **bio ≤ 2000 chars**, **topic ≤ 500
chars**, **notes ≤ 5000 chars** (notes use an explicit `.max(5000)` per-schema,
since it exceeds the shared `longTextSchema` bound).

## Route params

All `:id`-style params are validated as UUID v4 and rejected with **422** if
malformed (non-UUID strings, path traversal attempts, SQL injection payloads,
etc. never reach a controller or service). A small number of params are
intentionally *not* UUIDs (e.g. onboarding `stepId` slugs, calendar sync
tokens, a 4-digit tax `year`) — those get an explicit bounded
string/regex/number schema instead, documented inline in the schema file.

## `req.params` / `req.query` sanitization note

Express 5 makes `req.params` and `req.query` read-only getters, so the global
`sanitizeInput` middleware (`src/middleware/security.middleware.ts`) cannot
mutate them in place. It still runs SQL-injection **detection/logging** on
both, but the actual **rejection** of malformed params/query values is
enforced entirely through per-route Zod schemas via `validate()`.

## Coverage

Zero unvalidated endpoints remain in the v1 route files touched by this PR —
see the PR description for the full file list. Pre-existing `express-validator`
usage in `advanced-analytics.routes.ts`, `learning-path.routes.ts`, and
`progress.routes.ts` was left as-is; migrating those to Zod is tracked as
follow-up work, out of scope for this pass.

## Testing

The repo has no test runner installed. Rather than add one as a side effect
of this PR, schema behavior is covered by a minimal dependency-free harness:

```bash
npm run test:validators
```

See `src/validators/__tests__/`.
