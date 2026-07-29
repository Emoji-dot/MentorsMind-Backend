# Event Replay Runbook

## Overview

This runbook documents how to use EventReplayService to recover from read model corruption, rebuild projections, and backfill new analytics views.

## Problem Scenarios

### Scenario A: Read Model Corruption

**Symptom**: Bookings table contains inconsistent data (e.g., wrong mentor_id for a booking) that doesn't match the event log.

**Root Cause**: A bug in a migration, a failed transaction, or a projection handler crash corrupted the read model.

**Solution**: Replay all booking events through the projection handlers to rebuild the authoritative state.

### Scenario B: New Projection Added

**Symptom**: You've added a new projection handler (e.g., `mentor_session_counts`) but it only processes future events. Historical data is missing.

**Root Cause**: Projections are created to handle only new events; old events never trigger the new handler.

**Solution**: Replay all 50,000+ historical events through the new handler to backfill the projection.

### Scenario C: Projection Handler Bug

**Symptom**: A bug in a projection handler caused incorrect data to be written. The bug is now fixed.

**Root Cause**: The handler crashed or had business logic errors, leading to missing or wrong projections.

**Solution**: Clear the affected projection table and replay all events through the fixed handler.

## Architecture

### Event Storage

- Source of truth: `domain_events` table
- Contains immutable event log
- Each event has: aggregateId, aggregateType, version, data, metadata

### Replay Process

1. **Fetch Events**: Retrieve all events for an aggregate or type
2. **Apply Handlers**: Pass each event to registered projection handlers
3. **Idempotency**: Each handler uses `INSERT ... ON CONFLICT DO NOTHING` to prevent duplicates
4. **Error Handling**: Broken events are logged but replay continues
5. **Progress Tracking**: Redis stores replay progress with ETA

### Performance Baselines

- Single aggregate replay: <5 seconds
- Full replay (50,000 events): ~30 minutes
- Throughput: ~1,500 events/min (with 100-event batches)
- Memory: ~50MB for batch processing

## Endpoints

### Start Replay

```
POST /api/v1/admin/events/replay
```

**Replay single aggregate:**
```json
{
  "aggregateType": "booking",
  "aggregateId": "booking-123",
  "fromVersion": 1
}
```

Response (202 Accepted):
```json
{
  "success": true,
  "processedEvents": 15,
  "failedEvents": 0,
  "errors": []
}
```

**Replay all aggregates of a type (async):**
```json
{
  "aggregateType": "booking"
}
```

Response (202 Accepted):
```json
{
  "aggregateType": "booking",
  "total": 50000,
  "processed": 0,
  "failed": 0,
  "startedAt": "2024-07-29T10:15:30.000Z"
}
```

Note: Async replay runs in background. Poll progress endpoint.

### Get Replay Progress

```
GET /api/v1/admin/events/replay/status/booking
```

Response:
```json
{
  "aggregateType": "booking",
  "total": 50000,
  "processed": 12500,
  "failed": 2,
  "startedAt": "2024-07-29T10:15:30.000Z",
  "estimatedSecondsRemaining": 1260,
  "percentComplete": 25
}
```

### Clear Replay Progress

```
POST /api/v1/admin/events/replay/clear/booking
```

Response:
```json
{
  "aggregateType": "booking",
  "cleared": true
}
```

Use this to restart a failed replay.

## Step-by-Step Recovery

### Step 1: Identify Corruption

Query the read model (e.g., bookings table) and the event log:

```sql
-- Find bookings with inconsistent status
SELECT b.id, b.status, COUNT(e.id) as event_count
FROM bookings b
LEFT JOIN domain_events e ON b.id = e.aggregate_id
GROUP BY b.id, b.status
HAVING COUNT(e.id) = 0; -- Bookings with no events!
```

### Step 2: Verify Event Log is Healthy

```sql
-- Check for gaps in event version sequence
SELECT aggregate_id, COUNT(*) as event_count, MAX(version) as max_version
FROM domain_events
WHERE aggregate_type = 'booking'
GROUP BY aggregate_id
HAVING MAX(version) != COUNT(*);
```

If this returns rows, the event log has gaps. Contact data recovery team before proceeding.

### Step 3: Back Up Read Model

```sql
-- Create backup table
CREATE TABLE bookings_backup_2024_07_29 AS SELECT * FROM bookings;

-- Clear corrupted projection
DELETE FROM bookings;
```

Or use point-in-time restore if your RTO requires it.

### Step 4: Start Replay

```bash
curl -X POST https://api.example.com/api/v1/admin/events/replay \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "aggregateType": "booking"
  }'
```

### Step 5: Monitor Progress

Poll the status endpoint every 30 seconds:

```bash
while true; do
  curl https://api.example.com/api/v1/admin/events/replay/status/booking \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.percentComplete'
  sleep 30
done
```

Expected output:
```
0
5
12
25
50
...
100
```

### Step 6: Verify Replay Results

Compare row counts:

```sql
-- Check backup vs. current
SELECT 
  (SELECT COUNT(*) FROM bookings_backup_2024_07_29) as backup_count,
  (SELECT COUNT(*) FROM bookings) as current_count;
```

Sample data to verify correctness:

```sql
-- Spot-check a few bookings
SELECT id, mentor_id, learner_id, status, created_at
FROM bookings
WHERE id = 'booking-123';

-- Verify against events
SELECT data
FROM domain_events
WHERE aggregate_id = 'booking-123'
ORDER BY version;
```

### Step 7: Clean Up

Once verified:

```sql
-- Drop backup if satisfied
DROP TABLE bookings_backup_2024_07_29;

-- Clear replay progress
SELECT * FROM POST /api/v1/admin/events/replay/clear/booking
```

## Backfilling New Projections

### When You Add a New Projection

1. **Register the handler** in ProjectionService with idempotency:

```typescript
export async function handleNewProjection(
  event: DomainEvent,
  idempotencyKey: string
): Promise<void> {
  // Idempotency key prevents duplicate application
  await db.query(`
    INSERT INTO mentor_session_counts (mentor_id, session_count, idempotency_key)
    VALUES ($1, $2, $3)
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [event.data.mentorId, 1, idempotencyKey]);
}
```

2. **Create the projection table** if needed

3. **Trigger replay** to backfill:

```bash
curl -X POST https://api.example.com/api/v1/admin/events/replay \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "aggregateType": "session"
  }'
```

4. **Monitor** until 100% complete

5. **Verify** data is present:

```sql
SELECT COUNT(*) FROM mentor_session_counts;
```

## Error Handling

### Broken Events

If a single event causes a handler to crash, it's logged but replay continues:

```
"errors": [
  "Handler bookingProjectionHandler failed for event event-uuid: TypeError: Cannot read property 'status' of undefined"
]
```

**Action**: 

1. Review the error message
2. Determine if the event data is corrupted or the handler has a bug
3. Fix the handler logic
4. Re-run replay

### Replay Stalls

If progress hasn't updated in >5 minutes:

1. Check database for locks:
   ```sql
   SELECT * FROM pg_locks WHERE NOT granted;
   ```

2. Check Redis connection
3. Monitor server CPU/memory
4. Check application logs for errors

If stuck, clear progress and restart:
```bash
curl -X POST /api/v1/admin/events/replay/clear/booking
```

### Partial Failure

If replay completes with `failed > 0`, only some events were processed:

```json
{
  "total": 50000,
  "processed": 49998,
  "failed": 2,
  "errors": [
    "Event event-123 failed: Foreign key constraint violation"
  ]
}
```

**Action**:

1. Investigate the failed events:
   ```sql
   SELECT id, event_type, data, aggregate_id
   FROM domain_events
   WHERE id IN ('event-123', ...);
   ```

2. Determine if the event data is invalid or if there's a data dependency issue
3. Fix the underlying issue (e.g., missing parent record)
4. Re-run replay

## Performance Optimization

### Batch Size

Default batch size is 100 aggregates. Increase for faster replay:

```typescript
await EventReplayService.replayAllForType('booking', 500); // 5x batches
```

Trade-off: Larger batches use more memory but reduce overhead.

### Parallel Processing

Batches are processed in parallel by default. Monitor:
- Database connection pool (may need to increase)
- Memory usage
- CPU utilization

If database connection pool is exhausted, reduce batch size or limit concurrency in database config.

### Off-Peak Scheduling

Run replays during off-peak hours to avoid impacting user traffic:

```bash
# Schedule for 2 AM UTC
0 2 * * * curl -X POST /api/v1/admin/events/replay ...
```

## Idempotency Guarantees

### Projection Handler Implementation

Every projection handler must use idempotency:

```typescript
// BAD: No idempotency, duplicates on replay
await db.query('INSERT INTO table (mentor_id, count) VALUES ($1, $2)', 
  [event.data.mentorId, 1]);

// GOOD: Idempotent via conflict resolution
await db.query(`
  INSERT INTO table (mentor_id, count, idempotency_key)
  VALUES ($1, $2, $3)
  ON CONFLICT (idempotency_key) DO NOTHING
`, [event.data.mentorId, 1, idempotencyKey]);

// ALSO GOOD: Upsert pattern
await db.query(`
  INSERT INTO table (mentor_id, count, idempotency_key)
  VALUES ($1, $2, $3)
  ON CONFLICT (mentor_id) DO UPDATE
  SET count = table.count + 1
`, [event.data.mentorId, 1, idempotencyKey]);
```

## Related Documentation

- [Event Store Architecture](../docs/event-store.md)
- [Data Recovery](../docs/disaster-recovery.md)
- [Monitoring](../docs/monitoring.md)

## Support

For issues:
1. Check progress endpoint: `/api/v1/admin/events/replay/status/{aggregateType}`
2. Review application logs for handler errors
3. Query database for data consistency
4. Escalate to the data recovery team if event log is corrupted
