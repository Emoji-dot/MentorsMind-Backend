# API Portal — Developer Onboarding Guide

This is the fast path for a third-party developer evaluating the
MentorMinds API, using the documentation portal at `/api/v1/docs` (issue
#784).

## 1. Start with the portal overview

```
GET /api/v1/docs/portal
```

Returns every documented endpoint grouped by tag, plus links to everything
else in this guide (`swaggerUi`, `openApiSpec`, `openApi`,
`postmanCollection`, `changelog`, `sdkGuide`, `coverage`).

## 2. Browse and try endpoints interactively

Open `/api/v1/docs` in a browser for the Swagger UI. Click **Authorize**
(🔒) and paste a JWT from `POST /auth/login` to unlock authenticated
endpoints, then use **Try it out** on any operation.

### Sandbox mode

If the environment has `SANDBOX_MODE=true`, the server dropdown at the top
of the Swagger UI includes a **Sandbox** option. Selecting it routes
"Try it out" calls to `/api/v1/sandbox/*` fixture endpoints instead of real
ones — no real bookings, payments, or emails are created. This is the
fastest way to see the booking creation flow end-to-end:

```
GET  /api/v1/sandbox/mentors    # fixture mentor list
POST /api/v1/sandbox/bookings   # simulated booking creation
```

## 3. Import into Postman

```
GET /api/v1/docs/postman
```

Returns a Postman Collection v2.1 covering every documented endpoint,
grouped into folders by tag, with a `{{baseUrl}}` variable and bearer-auth
already wired up for endpoints that require it. Import the response body
directly into Postman.

## 4. Get the raw OpenAPI spec

```
GET /api/v1/docs/spec.json   # always application/json
GET /api/v1/docs/openapi     # same document, honors the Accept header
```

Use `/openapi` if your tooling requests
`application/vnd.oai.openapi+json` explicitly — the endpoint content
negotiates on the `Accept` header and returns `406` for unsupported types.

## 5. Check documentation coverage

```
GET /api/v1/docs/health
```

Returns `{ totalEndpoints, documentedEndpoints, coveragePct }` computed
live from the OpenAPI spec, so you can see how complete the reference is
before relying on it.

## 6. Track changes over time

```
GET /api/v1/docs/changelog
```

Also mirrored in [`CHANGELOG.md`](../CHANGELOG.md) at the repo root.

## 7. Read the SDK guide for common patterns

```
GET /api/v1/docs/sdk-guide
```

Code samples for authentication, pagination, error handling, rate-limit
headers, and webhooks.
