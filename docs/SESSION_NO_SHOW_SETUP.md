# Session No-Show Detection - Setup Guide

## Quick Start

This guide walks you through deploying the session no-show detection and automatic refund system.

---

## Prerequisites

- PostgreSQL database running
- Redis running (for presence tracking and BullMQ)
- Node.js environment configured
- Soroban smart contracts deployed (for escrow refunds)

---

## Installation Steps

### 1. **Run Database Migration**

Apply the migration to add join tracking columns:

```bash
# Navigate to database directory
cd database

# Run migration (Linux/Mac)
./migrate.sh

# Run migration (Windows)
migrate.bat
```

**Migration file**: `database/migrations/088_add_session_join_timestamps.sql`

**Verify migration**:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'bookings' 
  AND column_name IN ('mentor_joined_at', 'mentee_joined_at', 'no_show_detected_at', 'no_show_refund_tx_hash');
```

Expected output:
```
column_name              | data_type
-------------------------+------------------------------
mentor_joined_at         | timestamp with time zone
mentee_joined_at         | timestamp with time zone
no_show_detected_at      | timestamp with time zone
no_show_refund_tx_hash   | character varying
```

---

### 2. **Configure Environment Variables**

Add to your `.env` file:

```bash
# Grace period in minutes (default: 10)
NO_SHOW_GRACE_PERIOD_MINUTES=10
```

**Recommended values by environment:**
- **Development**: `1` (for faster testing)
- **Staging**: `5` (for realistic testing)
- **Production**: `10` (platform SLA)

---

### 3. **Restart Application**

The worker is automatically registered and will start on application boot:

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

**Verify worker started**:
```bash
# Check logs for worker registration
grep "session-no-show" logs/app.log

# Expected output:
# [Workers] Queue name validation passed
# [Workers] Session no-show worker registered
```

---

## Verification

### **1. Check Worker Health**

```typescript
import { sessionNoShowQueue } from './src/queues/session-no-show.queue';

// Check queue status
const counts = await sessionNoShowQueue.getJobCounts();
console.log('No-show queue status:', counts);
// { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 5 }
```

### **2. Test Join Endpoint**

```bash
# Create a test booking (get booking ID from response)
curl -X POST http://localhost:5000/api/v1/bookings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mentorId": "...",
    "scheduledAt": "2026-07-24T15:00:00Z",
    "durationMinutes": 60,
    "topic": "Test session"
  }'

# Test join endpoint
curl -X POST http://localhost:5000/api/v1/bookings/BOOKING_ID/join \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
# {
#   "success": true,
#   "message": "Successfully joined session",
#   "data": {
#     "sessionId": "...",
#     "role": "mentor",
#     "joinedAt": "2026-07-24T10:05:23.456Z",
#     "isFirstJoin": true
#   }
# }
```

### **3. Test Presence Endpoint**

```bash
curl -X GET http://localhost:5000/api/v1/bookings/BOOKING_ID/presence \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
# {
#   "success": true,
#   "data": {
#     "sessionId": "...",
#     "mentor": {
#       "userId": "...",
#       "joinedAt": "2026-07-24T10:05:23.456Z",
#       "online": true
#     },
#     "mentee": {
#       "userId": "...",
#       "joinedAt": null,
#       "online": false
#     }
#   }
# }
```

### **4. Test No-Show Detection**

**Method 1: Fast testing (development only)**

```bash
# Set grace period to 1 minute
export NO_SHOW_GRACE_PERIOD_MINUTES=1

# Create and confirm a booking with scheduled_at in the past
# Wait 1 minute
# Check booking status

psql -d mentorminds -c "
  SELECT id, status, mentor_joined_at, no_show_detected_at, no_show_refund_tx_hash
  FROM bookings
  WHERE id = 'YOUR_BOOKING_ID';
"
```

**Method 2: Manual job processing**

```typescript
import { processNoShowCheck } from './src/workers/session-no-show.worker';

// Manually trigger no-show check for testing
await processNoShowCheck({
  jobId: 'test-job',
  data: {
    bookingId: 'YOUR_BOOKING_ID',
    mentorId: 'MENTOR_ID',
    menteeId: 'MENTEE_ID',
    scheduledStart: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
    gracePeriodMinutes: 10,
  },
});
```

---

## Monitoring

### **Queue Dashboard**

Use BullMQ Board for visual monitoring:

```bash
npm install -g bull-board
bull-board --redis redis://localhost:6379
```

Navigate to: http://localhost:3000

**Key metrics to watch:**
- Delayed jobs count (scheduled no-show checks)
- Failed jobs (refund failures)
- Completed jobs rate

### **Database Queries**

**No-show rate per mentor:**
```sql
SELECT 
  mentor_id,
  COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
  COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed', 'no_show')) AS total_sessions,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'no_show') / 
    NULLIF(COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed', 'no_show')), 0),
    2
  ) AS no_show_rate_pct
FROM bookings
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY mentor_id
HAVING COUNT(*) FILTER (WHERE status = 'no_show') > 0
ORDER BY no_show_rate_pct DESC;
```

**Recent no-shows:**
```sql
SELECT 
  b.id,
  b.status,
  b.scheduled_at,
  b.no_show_detected_at,
  b.no_show_refund_tx_hash,
  m.full_name AS mentor_name,
  l.full_name AS mentee_name
FROM bookings b
JOIN users m ON b.mentor_id = m.id
JOIN users l ON b.mentee_id = l.id
WHERE b.status = 'no_show'
  AND b.no_show_detected_at > NOW() - INTERVAL '24 hours'
ORDER BY b.no_show_detected_at DESC;
```

**Refund success rate:**
```sql
SELECT 
  COUNT(*) AS total_no_shows,
  COUNT(*) FILTER (WHERE no_show_refund_tx_hash IS NOT NULL) AS successful_refunds,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE no_show_refund_tx_hash IS NOT NULL) / 
    NULLIF(COUNT(*), 0),
    2
  ) AS refund_success_rate_pct
FROM bookings
WHERE status = 'no_show'
  AND no_show_detected_at > NOW() - INTERVAL '7 days';
```

### **Logs**

**Follow worker logs:**
```bash
# Docker
docker logs -f mentorsmind-worker --tail 100

# PM2
pm2 logs worker --lines 100

# Raw logs
tail -f logs/worker.log | grep "no-show"
```

**Key log patterns:**
- `"No-show check scheduled"` - Job created successfully
- `"No-show detected — initiating refund process"` - Detection triggered
- `"Escrow refund initiated successfully"` - Refund completed
- `"No-show processing completed"` - Full cycle completed

---

## Troubleshooting

### **Issue: No-show not detected**

**Symptoms:**
- Booking remains `confirmed` after grace period
- No `no_show_detected_at` timestamp

**Diagnosis:**
```bash
# Check if job was scheduled
redis-cli KEYS "*no-show-check:*"

# Check job status
curl http://localhost:3000/api/queues/session-no-show-queue

# Check worker is running
ps aux | grep "session-no-show.worker"
```

**Common causes:**
1. Worker not started (`npm run dev` didn't pick up new worker)
2. Job scheduling failed (check Redis connection)
3. Booking status changed before grace period expired
4. Mentor joined but WebSocket failed to record join time

**Solution:**
```bash
# Restart workers
npm run workers:restart

# Verify worker registration
grep "sessionNoShowWorker" src/workers/index.ts
```

---

### **Issue: Refund failed**

**Symptoms:**
- `no_show_detected_at` set
- `no_show_refund_tx_hash` is `NULL`
- Error in worker logs

**Diagnosis:**
```sql
-- Check bookings with failed refunds
SELECT id, escrow_id, escrow_contract_address, payment_status
FROM bookings
WHERE status = 'no_show' 
  AND no_show_refund_tx_hash IS NULL;
```

**Common causes:**
1. Escrow contract not configured (`SOROBAN_ESCROW_CONTRACT_ADDRESS` missing)
2. Escrow already released/refunded
3. Insufficient Stellar balance for transaction fees
4. Network connectivity issues

**Solution:**
```bash
# Check Soroban configuration
grep "SOROBAN" .env

# Manual refund via admin panel
curl -X POST http://localhost:5000/api/v1/admin/bookings/BOOKING_ID/refund \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Or direct Soroban call
node scripts/manual-refund.js --booking-id BOOKING_ID
```

---

### **Issue: False positives (mentor joined but flagged)**

**Symptoms:**
- Mentor claims they joined on time
- Booking flagged as `no_show`
- `mentor_joined_at` is `NULL`

**Diagnosis:**
```sql
-- Check WebSocket connection logs
SELECT * FROM audit_logs
WHERE entity_type = 'session'
  AND entity_id = 'BOOKING_ID'
  AND action = 'session:join'
  AND created_at BETWEEN '...' AND '...';
```

**Common causes:**
1. WebSocket connection dropped before join recorded
2. Client used old version without join tracking
3. Mentor joined via browser refresh (lost WebSocket state)

**Solution:**
```typescript
// Manual join time update (admin only)
await pool.query(
  `UPDATE bookings 
   SET mentor_joined_at = $1, 
       status = 'confirmed',
       no_show_detected_at = NULL,
       updated_at = NOW()
   WHERE id = $2`,
  [mentorJoinTime, bookingId]
);

// Reverse refund (if already issued)
await SorobanEscrowService.releaseFunds({
  escrowId: booking.escrow_id,
  releasedBy: 'admin',
});
```

---

## Performance Tuning

### **Queue Concurrency**

Adjust worker concurrency in `src/config/queue.ts`:

```typescript
export const CONCURRENCY = {
  // ...
  SESSION_NO_SHOW: 3, // Increase for high volume
  // ...
};
```

**Recommendations:**
- **Low volume (<100 sessions/day)**: 1-3 workers
- **Medium volume (100-1000/day)**: 3-5 workers
- **High volume (>1000/day)**: 5-10 workers

### **Grace Period**

Adjust based on user feedback:

```bash
# Shorter grace period (stricter SLA)
NO_SHOW_GRACE_PERIOD_MINUTES=5

# Longer grace period (more lenient)
NO_SHOW_GRACE_PERIOD_MINUTES=15
```

**Impact analysis:**
```sql
-- How many no-shows would be prevented with different grace periods?
SELECT 
  COUNT(*) AS total_no_shows,
  COUNT(*) FILTER (WHERE mentor_joined_at - scheduled_at < INTERVAL '5 minutes') AS would_join_by_5min,
  COUNT(*) FILTER (WHERE mentor_joined_at - scheduled_at < INTERVAL '10 minutes') AS would_join_by_10min,
  COUNT(*) FILTER (WHERE mentor_joined_at - scheduled_at < INTERVAL '15 minutes') AS would_join_by_15min
FROM bookings
WHERE status = 'no_show'
  AND no_show_detected_at > NOW() - INTERVAL '30 days';
```

---

## Rollback Plan

If critical issues arise:

### **1. Disable No-Show Detection**

```bash
# Stop worker processing (emergency)
pm2 stop worker

# Or disable queue processing
redis-cli DEL bull:session-no-show-queue:*

# Keep application running but pause no-show checks
```

### **2. Revert Database Changes**

```sql
-- Migration rollback (if needed)
ALTER TABLE bookings 
  DROP COLUMN IF EXISTS mentor_joined_at,
  DROP COLUMN IF EXISTS mentee_joined_at,
  DROP COLUMN IF EXISTS no_show_detected_at,
  DROP COLUMN IF EXISTS no_show_refund_tx_hash;

DROP INDEX IF EXISTS idx_bookings_no_show_detection;
```

### **3. Remove Code Changes**

```bash
# Revert to previous version
git revert <commit-hash>

# Or cherry-pick revert
git cherry-pick --no-commit <revert-commit>

# Redeploy
npm run build
npm restart
```

---

## Production Checklist

Before deploying to production:

- [ ] Database migration applied and verified
- [ ] Environment variable `NO_SHOW_GRACE_PERIOD_MINUTES` set
- [ ] Soroban escrow contract configured and funded
- [ ] Redis connection stable (presence tracking)
- [ ] Worker logs configured (rotation, retention)
- [ ] Monitoring alerts configured (Datadog, Sentry, etc.)
- [ ] Load testing completed (100+ concurrent sessions)
- [ ] False positive rate validated (<0.1%)
- [ ] Refund success rate validated (>99%)
- [ ] Support team trained on dispute handling
- [ ] Documentation published to internal wiki

---

## Support Contacts

**For technical issues:**
- Slack: `#platform-engineering`
- Email: engineering@mentorsmind.com

**For business/policy questions:**
- Slack: `#product-team`
- Email: product@mentorsmind.com

**On-call escalation:**
- PagerDuty: Session No-Show Alert

---

**Last Updated**: July 24, 2026  
**Version**: 1.0.0
