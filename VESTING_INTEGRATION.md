# Vesting Contract Integration - Quick Start

This document provides a quick start guide for the vesting contract integration with the MentorsMind backend.

## Overview

The vesting integration connects the Soroban smart contract (`contracts/vesting/src/lib.rs`) with the backend API, providing:

- **Admin API**: Create, list, and revoke vesting schedules
- **Beneficiary API**: View schedules and claim vested tokens
- **PostgreSQL Mirror**: Fast queries without on-chain calls
- **Sync Worker**: Reconciles database with on-chain state every 6 hours
- **Audit Trail**: Complete history of all claims

## Quick Setup

### 1. Environment Configuration

Add to your `.env`:

```bash
# Soroban RPC endpoint
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Vesting contract address (from deployment)
SOROBAN_VESTING_CONTRACT_ADDRESS=CABC123...

# Platform wallet (admin key for creating schedules)
PLATFORM_SECRET_KEY=SABC123...
PLATFORM_PUBLIC_KEY=GABC123...

# Network
STELLAR_NETWORK=testnet
```

### 2. Database Migration

Run the migration to create vesting tables:

```bash
npm run migrate:up
```

This creates:
- `vesting_schedules` - Mirror table for on-chain schedules
- `vesting_claims` - Audit trail of claims
- `vesting_sync_log` - Sync operation logs

### 3. Start the Services

```bash
# Start API server
npm run dev

# Start worker (in separate terminal)
npm run dev:worker
```

The worker automatically:
- Starts vesting sync every 6 hours
- Reconciles PostgreSQL with on-chain data
- Logs sync statistics

## API Usage

### Create a Vesting Schedule (Admin)

```bash
POST /api/v1/admin/vesting/schedules
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "10000000",
  "cliffDuration": 7776000,
  "vestingDuration": 31536000,
  "vestingType": "team",
  "notes": "Senior Engineer - hired Jan 2024",
  "beneficiaryUserId": "uuid-optional"
}
```

**Duration Guidelines:**
- `cliffDuration`: 0 or ≥ 3600 (1 hour)
- `vestingDuration`: ≥ 86400 (1 day), ≤ 315360000 (10 years)

**Common Durations:**
- 3 months: 7,776,000 seconds
- 1 year: 31,536,000 seconds
- 4 years: 126,144,000 seconds

### Get My Schedules (Beneficiary)

```bash
GET /api/v1/vesting/my-schedules
Authorization: Bearer <user_token>
```

Response includes:
- All schedules for the user
- Current claimable amounts (calculated in real-time)
- Vesting progress percentages
- Cliff and vesting end timestamps

### Claim Vested Tokens

```bash
POST /api/v1/vesting/schedules/:id/claim
Authorization: Bearer <user_token>
```

**Requirements:**
- User must be the beneficiary
- User must have wallet address linked
- Claimable amount must be > 0

### List All Schedules (Admin)

```bash
GET /api/v1/admin/vesting/schedules?status=active&limit=50&offset=0
Authorization: Bearer <admin_token>
```

**Query Parameters:**
- `status`: Filter by `active`, `revoked`, `completed`
- `vestingType`: Filter by type (team, advisor, etc.)
- `limit`: Results per page (default 50)
- `offset`: Pagination offset

### Revoke a Schedule (Admin)

```bash
DELETE /api/v1/admin/vesting/schedules/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "Employee termination"
}
```

Unvested tokens are returned to the admin wallet.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Admin/User                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    REST API Calls
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend API Server                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Vesting Controller (src/controllers/vesting.controller.ts) │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼───────────────────────────────────┐ │
│  │    Vesting Service (src/services/vesting.service.ts)       │ │
│  │  • Wraps Soroban RPC calls                                 │ │
│  │  • Manages PostgreSQL mirror                               │ │
│  │  • Validates durations                                      │ │
│  └────────────┬───────────────────────┬───────────────────────┘ │
└───────────────┼───────────────────────┼──────────────────────────┘
                │                       │
     Soroban RPC Calls          PostgreSQL Queries
                │                       │
                ▼                       ▼
┌───────────────────────┐    ┌──────────────────────┐
│  Soroban Contract     │    │  PostgreSQL Database │
│  (On-chain)           │    │  (Mirror + Audit)    │
│  • create_schedule    │    │  • vesting_schedules │
│  • claim              │◄───┤  • vesting_claims    │
│  • revoke             │    │  • vesting_sync_log  │
│  • get_schedule       │    └──────────────────────┘
└───────────────────────┘              ▲
         ▲                             │
         │                             │
         └─────────────────────────────┘
                    Sync Worker
         (Every 6 hours or on-demand)
```

## Key Files

### Backend Code
- **Service**: `src/services/vesting.service.ts`
- **Controller**: `src/controllers/vesting.controller.ts`
- **Routes**: `src/routes/vesting.routes.ts`
- **Worker**: `src/workers/vesting-sync.worker.ts`
- **Queue**: `src/queues/vesting-sync.queue.ts`
- **Types**: `src/types/vesting.types.ts`

### Database
- **Migration**: `database/migrations/089_create_vesting_schedules.sql`

### Smart Contract
- **Source**: `contracts/vesting/src/lib.rs`

### Documentation
- **Full Guide**: `docs/VESTING.md`

## Validation Rules

The system enforces these rules (matching the smart contract):

### Cliff Duration
- **Minimum**: 3600 seconds (1 hour)
- **Alternative**: 0 (no cliff)
- **Rationale**: Prevents gaming via very short cliffs

### Vesting Duration
- **Minimum**: 86400 seconds (1 day)
- **Maximum**: 315360000 seconds (10 years)
- **Rationale**: Ensures reasonable vesting periods

### Timestamp Tolerance
- **Buffer**: 60 seconds added to cliff checks
- **Rationale**: Absorbs Stellar validator clock drift

## Common Operations

### Example: 4-Year Team Vesting with 1-Year Cliff

```javascript
// 1 year cliff = 365 days × 86400 = 31,536,000 seconds
// 4 year total = 1461 days × 86400 = 126,144,000 seconds
// After cliff, vesting continues for 3 more years

{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "1000000000000",  // 100,000 XLM in stroops
  "cliffDuration": 31536000,        // 1 year
  "vestingDuration": 126144000,     // 4 years total
  "vestingType": "team",
  "notes": "Engineer vesting - started Jan 2024"
}
```

### Example: Advisor Vesting (2 years, no cliff)

```javascript
{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "500000000000",   // 50,000 XLM
  "cliffDuration": 0,               // No cliff
  "vestingDuration": 63072000,      // 2 years
  "vestingType": "advisor",
  "notes": "Strategic advisor"
}
```

## Monitoring

### Check Sync Status

```sql
-- Recent sync operations
SELECT * FROM vesting_sync_log
ORDER BY sync_started_at DESC
LIMIT 10;

-- Failed syncs
SELECT * FROM vesting_sync_log
WHERE error_message IS NOT NULL
ORDER BY sync_started_at DESC;
```

### Check Active Schedules

```sql
-- All active schedules
SELECT 
  schedule_id,
  beneficiary_address,
  vesting_type,
  total_amount,
  claimed_amount,
  status
FROM vesting_schedules
WHERE status = 'active'
ORDER BY created_at DESC;
```

### Check Recent Claims

```sql
-- Recent claims with amounts
SELECT 
  c.schedule_id,
  c.beneficiary_address,
  c.amount_claimed,
  c.claimed_at,
  c.tx_hash,
  s.vesting_type
FROM vesting_claims c
JOIN vesting_schedules s ON c.schedule_id = s.schedule_id
ORDER BY c.claimed_at DESC
LIMIT 20;
```

## Troubleshooting

### Schedule Not Showing Up

**Symptom**: Created schedule doesn't appear in beneficiary's list

**Solutions**:
1. Check transaction hash in create response
2. Verify transaction on Stellar explorer
3. Trigger manual sync:
   ```typescript
   import { scheduleVestingScheduleSync } from './queues/vesting-sync.queue';
   await scheduleVestingScheduleSync(scheduleId);
   ```

### HTTP 422: Validation Error

**Common causes**:
- Cliff < 3600 seconds (use 0 for no cliff)
- Vesting < 86400 seconds (minimum 1 day)
- Vesting > 315360000 seconds (maximum 10 years)
- Cliff > vesting duration

### Claimable Amount is 0

**Check**:
1. Is cliff passed? Look at `isCliffPassed` in response
2. Already claimed? Check `claimedAmount` vs `totalAmount`
3. Sync lag? Trigger manual sync

### Worker Not Running

**Check logs**:
```bash
docker logs mentorsmind-backend | grep "vesting-sync"
```

**Verify queue**:
```typescript
import { vestingSyncQueue } from './queues/vesting-sync.queue';
const jobs = await vestingSyncQueue.getRepeatableJobs();
console.log('Vesting sync jobs:', jobs);
```

## Testing

### Manual Testing Checklist

1. ✅ Create schedule via API
2. ✅ Verify in database: `SELECT * FROM vesting_schedules;`
3. ✅ Check on-chain (use Stellar explorer or contract query)
4. ✅ Get schedule via beneficiary API
5. ✅ Wait or advance time (testnet)
6. ✅ Claim vested tokens
7. ✅ Verify claim in `vesting_claims` table
8. ✅ Check updated `claimed_amount`
9. ✅ Revoke schedule (admin)
10. ✅ Verify status changed to 'revoked'

### Unit Tests

```bash
npm run test:vesting
```

### Integration Tests

```bash
npm run test:integration:vesting
```

## Security Notes

- **Admin endpoints**: Require `admin` or `super_admin` role
- **Beneficiary endpoints**: Ownership verified by wallet address
- **Smart contract**: Enforces all security rules on-chain
- **Audit trail**: All claims logged in `vesting_claims` table
- **Rate limiting**: Applied to all endpoints

## Next Steps

1. **Deploy Contract**: Deploy vesting contract to testnet/mainnet
2. **Configure Env**: Set `SOROBAN_VESTING_CONTRACT_ADDRESS`
3. **Run Migration**: Create database tables
4. **Test API**: Create test schedules
5. **Monitor Sync**: Check sync logs after 6 hours
6. **Set Up Alerts**: Monitor for sync failures

## Support

- **Full Documentation**: See `docs/VESTING.md`
- **Smart Contract**: See `contracts/vesting/src/lib.rs`
- **GitHub Issues**: [mentorsmind/backend/issues](https://github.com/mentorsmind/backend/issues)

## Related Resources

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
- [Vesting Best Practices](https://www.notion.so/vesting-best-practices)
