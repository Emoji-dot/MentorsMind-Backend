# Webhook Delivery Circuit Breaker

Addresses issue #783: a single broken subscriber endpoint could previously
fill the webhook delivery queue with retries, delaying delivery to healthy
endpoints by minutes to hours.

## How it works

Each subscriber endpoint (keyed by a hash of its URL) has an independent
circuit tracked in Redis:

| Key | Purpose |
|---|---|
| `webhook:circuit:{hash}:failures` | Sorted set of failure timestamps — a sliding 5-minute window |
| `webhook:circuit:{hash}:open` | Present (with a 300s TTL) while the circuit is OPEN |
| `webhook:circuit:{hash}:halfopen` | Present for the OPEN period plus a further 300s grace window, during which exactly one probe is allowed |
| `webhook:circuit:{hash}:probe` | Claimed (`SET NX`) by whichever delivery attempt gets to run the half-open probe |

### States

- **Closed** — deliveries proceed normally. Failures are recorded in the
  sliding window; once 5 failures land within 5 minutes, the circuit opens.
- **Open** — new deliveries to this endpoint are not attempted. Instead of
  running (and timing out) against a dead endpoint, the job is re-queued
  with a 5-minute delay, freeing the worker to process other endpoints'
  deliveries immediately.
- **Half-open** — once the open period elapses, the *first* delivery
  attempt claims a probe slot (via `SET NX`) and is actually sent:
  - success → circuit closes, failure history is cleared.
  - failure → circuit re-opens for another 5-minute window.
  Any other attempts that arrive while a probe is in flight are deferred
  the same way as when the circuit is fully open.

## Where it's wired in

- `src/services/webhook-circuit-breaker.service.ts` — the circuit breaker
  itself (`check`, `reportOutcome`, `getStatus`).
- `src/jobs/webhookDelivery.job.ts` — checks the circuit before calling
  `WebhookService.executeDelivery`, and reports the outcome afterwards.
- `src/services/webhook.service.ts` — `executeDelivery` now returns
  `{ success: boolean }` so the worker can feed the outcome back to the
  breaker; `getCircuitBreakerStatus(url)` exposes state for the API.
- `GET /api/v1/webhooks/:id` — includes `circuit_breaker: { state, failures, lastFailureAt }`.
- `webhook_circuit_breaker_state{url_hash}` — Prometheus gauge
  (`0` = closed, `1` = open, `2` = half-open), scraped at `/metrics`.

## Notes

- The circuit breaker gates *whether an attempt is made at all* — it is
  independent of `WebhookService`'s own per-delivery exponential backoff
  (`RETRY_DELAYS_MS`) and the `MAX_CONSECUTIVE_FAILURES` auto-disable, which
  continue to operate unchanged for a given delivery's own retry lineage.
- URLs are only ever stored hashed in Redis keys and Prometheus labels —
  the raw endpoint URL is never used as a metric label.
