# Vesting System - Quick Reference Card

## 🚀 Quick Start Commands

### Setup
```bash
# Add to .env
SOROBAN_VESTING_CONTRACT_ADDRESS=CABC...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
PLATFORM_SECRET_KEY=SABC...

# Run migration
npm run migrate:up

# Start services
npm run dev              # API server
npm run dev:worker       # Worker process
```

## 📡 API Endpoints

### Admin
```bash
# Create schedule
POST /api/v1/admin/vesting/schedules

# List all
GET /api/v1/admin/vesting/schedules?status=active&limit=50

# Get by ID
GET /api/v1/admin/vesting/schedules/:id

# Revoke
DELETE /api/v1/admin/vesting/schedules/:id
```

### Beneficiary
```bash
# My schedules
GET /api/v1/vesting/my-schedules

# Claim tokens
POST /api/v1/vesting/schedules/:id/claim

# Claim history
GET /api/v1/vesting/schedules/:id/claims
```

### Public
```bash
# Query by address
GET /api/v1/vesting/schedules/by-address/:address
```

## ⏱️ Duration Quick Reference

| Period | Seconds | Example Use |
|--------|---------|-------------|
| 1 hour | 3,600 | Minimum cliff |
| 1 day | 86,400 | Minimum vesting |
| 1 week | 604,800 | Short vesting |
| 1 month | 2,592,000 | Monthly milestones |
| 3 months | 7,776,000 | Standard cliff |
| 6 months | 15,552,000 | Extended cliff |
| 1 year | 31,536,000 | Annual vesting |
| 2 years | 63,072,000 | Advisor vesting |
| 4 years | 126,144,000 | Team vesting |

## 💰 Amount Conversion

```javascript
// XLM to stroops
1 XLM = 10,000,000 stroops
100 XLM = 1,000,000,000 stroops

// Use in API
{
  "totalAmount": "1000000000"  // 100 XLM
}
```

## 📋 Common Request Bodies

### Team Member (4-year vest, 1-year cliff)
```json
{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "1000000000000",
  "cliffDuration": 31536000,
  "vestingDuration": 126144000,
  "vestingType": "team",
  "notes": "Senior Engineer"
}
```

### Advisor (2-year vest, no cliff)
```json
{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "500000000000",
  "cliffDuration": 0,
  "vestingDuration": 63072000,
  "vestingType": "advisor",
  "notes": "Strategic Advisor"
}
```

### Mentor Grant (1-year vest, 3-month cliff)
```json
{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "100000000000",
  "cliffDuration": 7776000,
  "vestingDuration": 31536000,
  "vestingType": "mentor_grant",
  "notes": "Top Mentor Q1 2024"
}
```

## 🔍 Monitoring Queries

### Check Active Schedules
```sql
SELECT schedule_id, beneficiary_address, vesting_type, 
       total_amount, claimed_amount, status
FROM vesting_schedules
WHERE status = 'active'
ORDER BY created_at DESC;
```

### Recent Claims
```sql
SELECT c.schedule_id, c.amount_claimed, c.claimed_at, 
       s.vesting_type, s.beneficiary_address
FROM vesting_claims c
JOIN vesting_schedules s ON c.schedule_id = s.schedule_id
ORDER BY c.claimed_at DESC
LIMIT 20;
```

### Sync Status
```sql
SELECT sync_started_at, schedules_synced, schedules_failed,
       sync_duration_ms, error_message
FROM vesting_sync_log
ORDER BY sync_started_at DESC
LIMIT 10;
```

### Total Vested Value
```sql
SELECT 
  vesting_type,
  COUNT(*) as schedules,
  SUM(total_amount) / 10000000.0 as total_xlm,
  SUM(claimed_amount) / 10000000.0 as claimed_xlm
FROM vesting_schedules
WHERE status = 'active'
GROUP BY vesting_type;
```

## ⚠️ Validation Rules

| Rule | Minimum | Maximum | Notes |
|------|---------|---------|-------|
| Cliff | 0 or 3,600s | N/A | 0 = no cliff, else ≥ 1 hour |
| Vesting | 86,400s | 315,360,000s | 1 day to 10 years |
| Cliff vs Vesting | Cliff ≤ Vesting | - | Cliff cannot exceed vesting |

## 🐛 Troubleshooting

### HTTP 422 Errors
```bash
# Cliff too short
"Cliff duration must be 0 or at least 3600 seconds"
→ Use 0 or ≥ 3600

# Vesting too short
"Vesting duration must be at least 86400 seconds"
→ Use ≥ 86400

# Vesting too long
"Vesting duration cannot exceed 315360000 seconds"
→ Use ≤ 315360000
```

### Claimable Amount is 0
```bash
# Check if cliff passed
GET /api/v1/vesting/my-schedules
# Look for "isCliffPassed": true

# Check if already claimed
# Compare "claimedAmount" vs "totalAmount"

# Trigger sync
# Wait 10 minutes after cliff passes
```

### Schedule Not Found
```bash
# Check database
SELECT * FROM vesting_schedules WHERE schedule_id = 1;

# Trigger sync
# Wait a few minutes

# Check transaction
# Look up txHash on Stellar explorer
```

## 🔧 Manual Sync

### Sync Single Schedule
```typescript
import { scheduleVestingScheduleSync } from './queues/vesting-sync.queue';
await scheduleVestingScheduleSync(1); // schedule_id
```

### Sync All Schedules
```typescript
import { scheduleVestingSync } from './queues/vesting-sync.queue';
await scheduleVestingSync();
```

## 📊 Response Fields

### Schedule Response
```json
{
  "scheduleId": 1,              // On-chain ID
  "beneficiaryAddress": "...",  // Stellar address
  "totalAmount": "10000000",    // In stroops
  "claimedAmount": "2500000",   // In stroops
  "claimableNow": "1250000",    // Calculated
  "claimablePercent": 37.5,     // Percentage
  "isCliffPassed": true,        // Boolean
  "isFullyVested": false,       // Boolean
  "cliffEnd": 1735689600,       // Unix timestamp
  "vestingEnd": 1767225600,     // Unix timestamp
  "status": "active",           // active/revoked/completed
  "vestingType": "team"         // Category
}
```

## 🔐 Authorization Headers

```bash
# Admin requests
Authorization: Bearer <admin-jwt>

# User requests
Authorization: Bearer <user-jwt>

# Public requests
# No authorization needed
```

## 📈 Key Metrics

### Track Daily
- Schedules created
- Claims processed
- Total value claimed
- Sync success rate

### Alert On
- Sync failures > 5% (24h)
- No sync in 12 hours
- High error rate (> 10%)
- Claim failures

## 🔄 Worker Schedule

```
Vesting Sync: Every 6 hours
Cron: 0 */6 * * *
Times: 00:00, 06:00, 12:00, 18:00 UTC
```

## 📁 Important Files

```
Services:     src/services/vesting.service.ts
Controller:   src/controllers/vesting.controller.ts
Routes:       src/routes/vesting.routes.ts
Worker:       src/workers/vesting-sync.worker.ts
Types:        src/types/vesting.types.ts
Migration:    database/migrations/089_create_vesting_schedules.sql
Docs:         docs/VESTING.md
Quick Start:  VESTING_INTEGRATION.md
```

## 🆘 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | No auth token | Add `Authorization: Bearer <token>` |
| 403 Forbidden | Wrong role | Use admin token for admin endpoints |
| 404 Not Found | Invalid ID | Check schedule_id exists |
| 422 Validation | Invalid input | Check cliff/vesting durations |
| 400 Nothing to claim | Before cliff | Wait until cliff passes |

## 📞 Support

- **Docs**: `docs/VESTING.md`
- **Quick Start**: `VESTING_INTEGRATION.md`
- **Tests**: `tests/vesting.api.test.md`
- **Summary**: `VESTING_IMPLEMENTATION_SUMMARY.md`
