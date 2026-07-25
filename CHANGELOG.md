# Changelog

All notable changes to the MentorMinds Backend API are documented here.
This mirrors `GET /api/v1/docs/changelog`, which serves this history
programmatically for the API documentation portal (issue #784).

## 1.4.0 — 2026-07-25

- **Notifications worker (#782)**: `notifications.worker.ts` now tracks
  delivery status independently per channel (`email`, `push`, `websocket`)
  in `job.data.channelStatus`. On retry, only channels still marked
  `failed` are re-attempted — a channel that already succeeded is never
  re-sent. Each channel has its own retry budget (email: 3, push: 5,
  websocket/in-app: 2); once exhausted the channel is moved to the new
  `notification_dead_letter_queue` table and, for `email`/`push`, an admin
  alert is logged. Delivery attempts are tracked via the
  `notification_delivery_attempts_total{channel,status}` Prometheus counter
  and the `notification_delivery_status` materialized view (per-channel
  delivery rate, trailing 24 hours).
- **Webhook delivery circuit breaker (#783)**: each subscriber endpoint now
  has an independent circuit breaker (tracked in Redis) that opens after 5
  failures in a sliding 5-minute window. While open, new deliveries to that
  endpoint are deferred for 5 minutes instead of consuming a worker slot —
  so one broken endpoint's retry storm can no longer delay delivery to
  healthy endpoints. A single half-open probe determines whether the
  circuit closes or re-opens. State is exposed via the
  `webhook_circuit_breaker_state{url_hash}` gauge and, **additively**, via a
  new `circuit_breaker` field on `GET /api/v1/webhooks/:id`.
- **API documentation portal (#784)**: added `GET /api/v1/docs/postman`
  (Postman Collection v2.1 generator), `GET /api/v1/docs/openapi` (raw spec
  with Accept-header content negotiation), `GET /api/v1/docs/health`
  (live documentation coverage metrics), and sandbox fixture routes at
  `/api/v1/sandbox/*` that the Swagger UI can target in "Try it out" mode
  when `SANDBOX_MODE=true`.
- **CI security scanning (#785)**: added an OWASP ZAP baseline scan,
  `npm audit --audit-level=high` as a required gate, and an automated
  security-headers check to the CI pipeline.

## 1.3.0 — 2026-04-01

- Session Quality Analytics with ML scoring (#538)
- Comprehensive API Documentation Portal (#537)
- Trend detection with linear regression
- Sentiment analysis for session feedback

## 1.2.0 — 2026-03-01

- Advanced analytics dashboard
- Session recording and transcription
- Referral program

## 1.1.0 — 2026-02-01

- Added Learning Path Builder
- Session milestone tracking
- Certification system

## 1.0.0 — 2026-01-01

- Initial stable release
- Auth, Users, Mentors, Bookings, Payments, Wallets
- Stellar blockchain integration
