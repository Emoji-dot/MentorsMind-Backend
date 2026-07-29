# Push Notification Deliverability

This documents the changes made to improve push notification deliverability.

Key improvements
- Immediate deletion of invalid tokens when Firebase returns `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`.
- Weekly background job to validate and remove invalid tokens: `push-token-cleanup`.
- Token refresh on device app open: upsert token and deactivate same user/device tokens older than 30 days.
- New DB column `is_valid` on `push_tokens` to track validation state.
- Prometheus metrics: `push_token_invalid_total` and `push_notifications_sent_total{status}`.

How it works
- When a push send fails with invalid token errors the token is deleted immediately from the DB to avoid repeated failures.
- The weekly cleanup job runs and validates active tokens in batches using FCM multicast responses and removes invalid tokens in bulk.
- When the client calls the push subscribe endpoint, the server upserts the token and deactivates older tokens for the same device (>30 days).

Operators
- Migration: run DB migrations to add `is_valid` column: `database/migrations/055_add_is_valid_to_push_tokens.sql`.
- Worker: the new worker `pushTokenCleanupWorker` runs weekly via the scheduler (Sunday 03:00 UTC). To run manually enqueue the job via the queue or call `runPushTokenCleanupJob()`.

Metrics
- `push_token_invalid_total`: increments when an invalid token is detected and removed.
- `push_notifications_sent_total{status}`: increments per notification attempt with `status=success|failure`.

Notes
- The cleanup job uses FCM multicast responses to detect invalid tokens. If dry-run support is available in your Firebase SDK, consider enabling it for the cleanup job to avoid sending visible notifications during validation.
