# Background Check Provider

Background checks use a provider adapter selected by `BACKGROUND_CHECK_PROVIDER`.

## Providers

- `BACKGROUND_CHECK_PROVIDER=checkr` uses Checkr REST APIs and requires `CHECKR_API_KEY`.
- `BACKGROUND_CHECK_PROVIDER=mock` uses deterministic local/test results from `BACKGROUND_CHECK_MOCK_RESULT`.

Production defaults to Checkr when no provider is configured. Non-production defaults to the mock adapter.

## Webhooks and polling

Checkr completion callbacks are accepted at:

```text
POST /api/v1/admin/background-checks/webhook
```

The scheduler also polls pending provider checks every 6 hours for providers or events that do not complete via webhook.

Every transition is written to `audit_logs` with action `background_check.transition`.

