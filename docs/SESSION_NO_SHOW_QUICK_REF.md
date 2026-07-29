# Session No-Show Detection - Quick Reference

## 🎯 Quick Links

- **Full Policy**: [SESSION_NO_SHOW_POLICY.md](./SESSION_NO_SHOW_POLICY.md)
- **Setup Guide**: [SESSION_NO_SHOW_SETUP.md](./SESSION_NO_SHOW_SETUP.md)
- **Implementation**: [../IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md)

---

## 📋 One-Minute Overview

**What**: Automatic no-show detection + refund for mentors who don't join sessions  
**When**: 10 minutes after scheduled start (configurable)  
**How**: BullMQ worker checks join status → Soroban escrow refund → notifications  

---

## 🚀 Quick Start

### Deploy
```bash
# 1. Run migration
cd database && ./migrate.sh

# 2. Set environment variable
echo "NO_SHOW_GRACE_PERIOD_MINUTES=10" >> .env

# 3. Restart app (worker auto-registers)
npm restart
```

### Verify
```bash
# Check worker started
grep "sessionNoShowWorker" logs/app.log

# Test join endpoint
curl -X POST http://localhost:5000/api/v1/bookings/{id}/join \
  -H "Authorization: Bearer {token}"
```

---

## 🔌 API Endpoints

### Join Session
```http
POST /api/v1/bookings/:id/join
Authorization: Bearer {token}
```

**Response**: `{ success: true, data: { joinedAt: "...", role: "mentor" } }`

### Get Presence
```http
GET /api/v1/bookings/:id/presence
Authorization: Bearer {token}
```

**Response**: 
```json
{
  "mentor": { "joinedAt": "...", "online": true },
  "mentee": { "joinedAt": null, "online": false }
}
```

---

## 🗄️ Database

### New Columns
- `mentor_joined_at` - When mentor joined
- `mentee_joined_at` - When mentee joined
- `no_show_detected_at` - When no-show was flagged
- `no_show_refund_tx_hash` - Stellar transaction hash

### Query No-Shows
```sql
SELECT * FROM bookings 
WHERE status = 'no_show' 
  AND no_show_detected_at > NOW() - INTERVAL '24 hours';
```

---

## 🔍 Monitoring

### Key Metrics
- **No-show rate**: `COUNT(no_show) / COUNT(confirmed)` per mentor
- **Refund success**: `COUNT(no_show_refund_tx_hash) / COUNT(no_show)`
- **False positives**: Manual review of disputed no-shows

### Check Queue
```bash
redis-cli KEYS "*no-show-check:*"
```

### Logs
```bash
tail -f logs/worker.log | grep "no-show"
```

---

## 🐛 Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| No-show not detected | Worker not running | `npm run workers:restart` |
| Refund failed | Soroban config missing | Check `.env` for `SOROBAN_*` |
| False positive | WebSocket join failed | Manual admin refund |

---

## 📞 Support

- **Technical**: `#platform-engineering` on Slack
- **Business**: `#product-team` on Slack
- **On-call**: PagerDuty "Session No-Show Alert"

---

## ⚙️ Configuration

```bash
# Grace period (minutes)
NO_SHOW_GRACE_PERIOD_MINUTES=10

# Worker concurrency (src/config/queue.ts)
CONCURRENCY.SESSION_NO_SHOW = 3
```

---

## 🧪 Testing

### Fast Test (Development)
```bash
# Set 1-minute grace period
export NO_SHOW_GRACE_PERIOD_MINUTES=1

# Create booking with past scheduled_at
# Wait 1 minute
# Check status: should be 'no_show'
```

### Manual Trigger
```typescript
import { processNoShowCheck } from './workers/session-no-show.worker';

await processNoShowCheck({
  bookingId: '...',
  mentorId: '...',
  menteeId: '...',
  scheduledStart: new Date(Date.now() - 15 * 60 * 1000),
  gracePeriodMinutes: 10,
});
```

---

## 📊 Common Queries

### No-Show Rate
```sql
SELECT 
  mentor_id,
  COUNT(*) FILTER (WHERE status = 'no_show') * 100.0 / COUNT(*) AS rate
FROM bookings
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY mentor_id;
```

### Failed Refunds
```sql
SELECT * FROM bookings
WHERE status = 'no_show' 
  AND no_show_refund_tx_hash IS NULL;
```

### Join Delay Stats
```sql
SELECT 
  AVG(EXTRACT(EPOCH FROM (mentor_joined_at - scheduled_at)) / 60) AS avg_minutes
FROM bookings
WHERE mentor_joined_at IS NOT NULL;
```

---

**Version**: 1.0.0  
**Last Updated**: July 24, 2026
