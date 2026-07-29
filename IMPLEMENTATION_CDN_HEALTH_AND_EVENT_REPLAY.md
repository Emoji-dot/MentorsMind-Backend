# Implementation: CDN Health Monitoring and Event Replay

## Overview

This implementation adds two major operational capabilities to MentorsMind:

1. **CDN Health Monitoring** — Automatic failover, circuit breaker, and retry queue for cache invalidations
2. **Event Replay** — Recover from read model corruption and backfill new projections

## Changes Summary

### New Files Created

#### Services
- `src/services/cdn-health.service.ts` - CDN domain health monitoring
- `src/services/event-replay.service.ts` - Event replay and projection backfill

#### Jobs
- `src/jobs/cdn-health.job.ts` - 60-second background health checks
- `src/jobs/cdn-invalidation.job.ts` - 5-minute invalidation retry queue

#### Controllers  
- `src/controllers/cdn-admin.controller.ts` - CDN health admin endpoints
- `src/controllers/event-replay-admin.controller.ts` - Event replay admin endpoints

#### Utilities
- `src/utils/cdn-metrics.utils.ts` - Prometheus metrics for CDN health

#### Database
- `database/migrations/107_create_cdn_invalidation_queue.sql` - Retry queue table

#### Documentation
- `docs/CDN_FAILOVER_RUNBOOK.md` - CDN failover incident response guide
- `docs/EVENT_REPLAY_RUNBOOK.md` - Event replay recovery procedures

### Modified Files

- `src/services/cdn.service.ts`:
  - Updated `getAssetUrl()` to use `CDNHealthService.getHealthiestDomain()`
  - Updated `invalidate()` to queue failed invalidations for retry
  - Added import for CDNHealthService

- `src/config/queue.ts`:
  - Added `CDN_INVALIDATION` queue name
  - Added CDN_INVALIDATION concurrency (5)

## Architecture

### CDN Health Monitoring

```
┌─────────────────────────────────────────────┐
│  CDN Health Job (every 60 seconds)         │
│  ├─ Check CloudFront domain                │
│  ├─ Check Cloudflare domain                │
│  └─ Check Fastly domain                    │
└──────────────┬──────────────────────────────┘
               │
               ▼
         ┌──────────────────┐
         │  Redis Cache     │
         │  (60s TTL)       │
         │  cdn:health:*    │
         └──────────────────┘
               │
               ▼
      ┌────────────────────────┐
      │  getAssetUrl()         │
      │  ├─ Query Redis        │
      │  ├─ Select healthiest  │
      │  └─ Fall back to first │
      └────────────────────────┘
```

**Health Check Flow:**
1. Make HEAD request to `/health-check-asset.txt`
2. Measure response time (latency in ms)
3. Track consecutive failures per domain
4. Open circuit after 3 failures
5. Auto-close circuit after 5-minute cooldown
6. Store results in Redis for 60 seconds

**Domain Selection:**
1. Filter to healthy domains only
2. Choose the fastest healthy domain by latency
3. If all unhealthy, use first domain (fallback to origin)

### CDN Invalidation Retry

```
┌──────────────────────────┐
│  CDNService.invalidate() │
└───────────┬──────────────┘
            │
     ┌──────▼──────┐
     │ API Call    │
     │ Success?    │
     └──┬───────┬──┘
        │       │
      YES      NO
        │       │
        │       ▼
        │   ┌─────────────────────────────┐
        │   │ Queue for Retry             │
        │   │ ├─ Insert to DB table       │
        │   │ └─ Add to BullMQ queue      │
        │   └────────────┬────────────────┘
        │                │
        │                ▼
        │        ┌──────────────────────┐
        │        │ Retry Every 5 Minutes│
        │        │ (24 hours max)       │
        │        │ 288 attempts × 5m    │
        │        └──────────────────────┘
        │
        ▼
    Success
```

**Retry Queue:**
- Stored in `cdn_invalidation_queue` table
- BullMQ worker retries every 5 minutes
- Max 24-hour retry window (288 attempts)
- Status: pending → completed/failed
- Tracks attempt count and error messages

### Event Replay

```
┌─────────────────────────────┐
│  EventReplayService         │
│  ├─ replayAggregate()       │
│  │  └─ Single aggregate     │
│  └─ replayAllForType()      │
│     └─ All aggregates       │
└────────────┬────────────────┘
             │
             ▼
      ┌──────────────────┐
      │ domain_events    │
      │ (immutable log)  │
      └────────┬─────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ For each event:              │
    │ ├─ Get projection handlers   │
    │ ├─ Call handler with event   │
    │ ├─ Use ON CONFLICT DO NOTHING│
    │ └─ Log failures but continue │
    └──────────────┬───────────────┘
                   │
                   ▼
          ┌────────────────────┐
          │ Projections tables │
          │ (read models)      │
          └────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │ Redis Progress Tracking      │
    │ ├─ total aggregates          │
    │ ├─ processed count           │
    │ ├─ failed count              │
    │ └─ ETA remaining             │
    └──────────────────────────────┘
```

**Replay Process:**
1. Fetch all events from event store
2. Group by aggregate (if replaying all)
3. Batch process aggregates (default 100 per batch)
4. For each event, call all registered projection handlers
5. Wrap handlers in try/catch to skip broken events
6. Use `INSERT ... ON CONFLICT DO NOTHING` for idempotency
7. Track progress in Redis with ETA
8. Update status as completed/failed

## Admin Endpoints

### CDN Health

```
GET /api/v1/admin/cdn/health
```
Get per-domain CDN health status and metrics.

```
POST /api/v1/admin/cdn/health/check/{domain}
```
Manually trigger health check for a domain.

```
POST /api/v1/admin/cdn/health/clear/{domain}
```
Clear circuit breaker for manual recovery.

```
GET /api/v1/admin/cdn/invalidation-queue/stats
```
Get CDN invalidation retry queue statistics.

### Event Replay

```
POST /api/v1/admin/events/replay
```
Start replay of events (single aggregate or all of type).

```
GET /api/v1/admin/events/replay/status/{aggregateType}
```
Get current replay progress and ETA.

```
POST /api/v1/admin/events/replay/clear/{aggregateType}
```
Clear replay progress to restart.

## Integration Steps

### 1. Database Migration

Run migration to create `cdn_invalidation_queue` table:

```bash
npm run migrate:up
```

This creates:
- `cdn_invalidation_queue` table with status tracking
- Indexes on status, attempt, and created_at
- Trigger for auto-updating timestamps

### 2. Initialize Health Checks

In your bootstrap code (e.g., `src/bootstrap.ts`), start the health check job:

```typescript
import { startCDNHealthChecks } from './jobs/cdn-health.job';

// After server is initialized
startCDNHealthChecks();
```

### 3. Start Invalidation Queue Worker

In your worker bootstrap (`src/worker-bootstrap.ts`), start the retry worker:

```typescript
import { cdnInvalidationWorker } from './jobs/cdn-invalidation.job';

// Worker starts automatically when imported
```

### 4. Register Projection Handlers

In `ProjectionService`, register all handlers with idempotency:

```typescript
async function handleBookingCreated(
  event: DomainEvent,
  idempotencyKey: string
): Promise<void> {
  await db.query(`
    INSERT INTO bookings (id, mentor_id, learner_id, status, idempotency_key)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [...]);
}

// Register handler
ProjectionService.register('BookingCreated', handleBookingCreated);
```

### 5. Update Metrics Collection

In your metrics collection job, update CDN health metrics:

```typescript
import { updateCDNHealthMetrics } from './utils/cdn-metrics.utils';

// After collecting health data
for (const domain of domains) {
  const health = await CDNHealthService.getHealthStatus([domain]);
  updateCDNHealthMetrics(
    domain,
    health[domain].latencyMs,
    health[domain].healthy,
    health[domain].circuitOpen || false
  );
}
```

## Configuration

### Environment Variables

No new environment variables required. Uses existing:
- `CDN_PROVIDER` - cloudfront, cloudflare, or fastly
- `CDN_DOMAINS` - Comma-separated list of CDN domains
- `CDN_BASE_URL` - Primary CDN base URL

### Optional Tuning

In `CDNHealthService`:
- `HEALTH_CHECK_TIMEOUT` (5000ms) - Timeout for health checks
- `CIRCUIT_BREAKER_THRESHOLD` (3) - Failures to open circuit
- `CIRCUIT_BREAKER_COOLDOWN` (300000ms) - 5 minutes
- `HEALTH_CHECK_INTERVAL` (60000ms) - 60 seconds

In `CDNInvalidationJob`:
- Max attempts: 288 (24 hours with 5-min retries)
- Backoff: Fixed 5 minutes
- Concurrency: 5 concurrent retries

In `EventReplayService`:
- `BATCH_SIZE` (100) - Aggregates per batch
- `PROGRESS_UPDATE_INTERVAL` (10) - Update every N batches

## Monitoring

### Prometheus Metrics

```
cdn_domain_health{domain="..."} = 1|0
cdn_domain_latency_ms{domain="..."}
cdn_circuit_breaker_open{domain="..."} = 1|0
cdn_invalidation_failures_total{provider="...", reason="..."}
cdn_invalidation_success_total{provider="..."}
cdn_invalidation_retries_total{provider="..."}
cdn_invalidation_queue_size{status="pending|completed|failed"}
```

### Dashboards

Create Grafana dashboards for:
- CDN domain health status
- Domain latency percentiles
- Invalidation success/failure rates
- Retry queue depth and age
- Replay progress and ETA

### Alerts

Recommend alerting on:
- `cdn_circuit_breaker_open == 1` - Circuit open for >5 minutes
- `cdn_invalidation_failures_total` - Increasing counter
- `cdn_invalidation_queue_size{status="failed"} > 10` - Queued failures
- All CDN domains unhealthy

## Testing

### Test CDN Health Monitoring

```bash
# 1. Verify health endpoint returns metrics
curl http://localhost:5000/api/v1/admin/cdn/health

# 2. Simulate domain failure (block with firewall)
# Verify circuit opens after 3 failures (~3 minutes)

# 3. Restore domain
# Verify circuit closes after 5 minute cooldown

# 4. Verify getAssetUrl() uses healthiest domain
```

### Test Invalidation Retry

```bash
# 1. Simulate API failure (mock provider down)
# 2. Call CDNService.invalidate() → fails
# 3. Check database for retry queue entry
# 4. Verify retry job processes every 5 minutes
# 5. Restore API and verify success
```

### Test Event Replay

```bash
# 1. Corrupt a projection table (e.g., DELETE FROM bookings)
# 2. POST /api/v1/admin/events/replay {aggregateType: "booking"}
# 3. Monitor GET /api/v1/admin/events/replay/status/booking
# 4. Verify projection table is repopulated
# 5. Compare row count with backup
```

## Performance Expectations

### CDN Health Monitoring
- Health check latency: <100ms per domain
- Memory usage: <10MB
- Redis usage: ~1KB per domain per health record
- CPU impact: Minimal (~1% per interval)

### Event Replay
- Single aggregate: <5 seconds
- Full replay (50,000 events): ~30 minutes
- Throughput: ~1,500 events/min
- Memory: ~50MB for batch processing
- Database connections: 5 per batch

### Invalidation Retry
- Queue insertion: <10ms
- Retry processing: ~1 second per batch
- Concurrency: 5 retries in parallel
- Overhead: Negligible

## Rollback Plan

If issues arise:

1. **Disable health checks**: Comment out `startCDNHealthChecks()` in bootstrap
2. **Disable retry queue**: Pause BullMQ worker
3. **Revert to old getAssetUrl()**: Remove health check logic
4. **Drop tables**: `DROP TABLE cdn_invalidation_queue;`
5. **Revert migration**: `npm run migrate:down`

## Next Steps

1. Review the CDN failover runbook for incident procedures
2. Review the event replay runbook for data recovery procedures
3. Create Grafana dashboards for monitoring
4. Set up alerts for circuit breaker and failed invalidations
5. Run disaster recovery drills with test data

## Documentation References

- [CDN Failover Runbook](./docs/CDN_FAILOVER_RUNBOOK.md)
- [Event Replay Runbook](./docs/EVENT_REPLAY_RUNBOOK.md)
- [CDN Service](./src/services/cdn.service.ts)
- [Event Store Service](./src/services/event-store.service.ts)
