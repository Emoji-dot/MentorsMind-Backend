# Outbox Dead-Letter Runbook

> Companion to `docs/OUTBOX_PATTERN.md`. Use this when an event is
> stuck, retrying, or has been moved to the dead-letter queue.

## What "dead-letter" means

An outbox row reaches `status = 'dead_letter'` when its worker has
attempted to dispatch it `OUTBOX_MAX_ATTEMPTS` (default `5`) times
without success. The row is **NOT** deleted; it stays in
`outbox_events` for operator inspection.

Common causes:

- The downstream queue is misconfigured (wrong name, bad permissions).
- A payload schema mismatch — the dispatcher tries to read a field that
  was renamed in the consumer.
- A third-party API (Stripe, Telegram, Email provider) is returning
  5xx for several minutes.
- A back-end service (Soroban, etc.) is unreachable from the worker
  pod's network.

## How to inspect the DLQ

### Via the CLI replay script (preferred)

```bash
# List the 50 most recent dead-letter rows
DATABASE_URL=... npx ts-node scripts/outbox-replay.ts list --limit 50

# Pretty-print a single row by id
DATABASE_URL=... npx ts-node scripts/outbox-replay.ts show <outbox-id>
```

### Via direct SQL

```sql
-- Depth by status (good for an alert / dashboard)
SELECT status, COUNT(*) AS n FROM outbox_events GROUP BY status;

-- Recently dead-lettered events
SELECT id, aggregate_type, event_type, attempts, last_error, created_at
FROM outbox_events
WHERE status = 'dead_letter'
ORDER BY created_at DESC
LIMIT 100;
```

## How to replay a dead-letter event

> Replay moves a dead-letter row back to `pending` with
> `attempts = 0` and `last_error = NULL`. The worker will pick it up
> on the next tick.

### Replay one event

```bash
DATABASE_URL=... npx ts-node scripts/outbox-replay.ts replay <outbox-id>
```

Output:

```
[OutboxReplay] Replayed outbox_id=… attempts reset, will be dispatched on next tick.
```

### Replay many events by filter

```bash
# Replay all dispute-related dead-letter rows created in the last 24h
DATABASE_URL=... npx ts-node scripts/outbox-replay.ts replay-many \
  --aggregate-type dispute \
  --since '24 hours ago'
```

## Alert thresholds

Configure your monitoring to alert when:

| Signal                                | Threshold                     |
| ------------------------------------- | ----------------------------- |
| `outbox_events WHERE status='dead_letter'` count | `> 0` for `5m`           |
| `outbox_events WHERE status='pending'` count    | `> 1000` for `10m`      |
| `outbox_events WHERE status='failed'` count     | `> 50` for `10m`        |
| Max age of any `pending` row                    | `> 60s` (worker is stuck) |

The `outbox_dead_letter_total` counter from the dispatcher increments
once per dead-letter transition. Pair it with a Sentry alert for
real-time pager notifications.

## Common fixes

| Symptom                                          | Likely fix                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------|
| Every event of a given `event_type` is dead-letter | Bug in the dispatcher / consumer. Inspect `last_error`, fix, push, replay all matching rows. |
| `pending` queue depth climbing, no failures       | Worker is not running. Check Railway logs for the `Worker` service.                          |
| Spike in `failed` after a queue config change     | Old `addBulk` calls hitting a queue that was renamed. Update destinations.                    |
| Spike in `dead_letter` after a deploy            | Check `--since '1 hour ago'` replay-many with the deploy timestamp.                          |

## When in doubt

If you have to choose between **deleting** a dead-letter row or
**replaying** it — replay. The downstream consumers are all
idempotent (BullMQ `jobId` dedup + `idempotency_key` UNIQUE
constraint on outbox rows). Worst case: a duplicate webhook delivery
which the customer's HTTP endpoint already tolerates via the
`X-Webhook-Idempotency-Key` header (see `docs/webhooks.md`).
