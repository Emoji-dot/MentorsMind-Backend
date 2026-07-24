# Vesting API Test Suite

Sample API tests for the vesting integration. Use these as examples for manual testing or automated test suites.

## Prerequisites

```bash
# Set environment variables
export API_URL=http://localhost:5000/api/v1
export ADMIN_TOKEN=<your-admin-jwt>
export USER_TOKEN=<your-user-jwt>
export BENEFICIARY_ADDRESS=GABC123...
```

## Test 1: Create Vesting Schedule (Admin)

### Request
```bash
curl -X POST "$API_URL/admin/vesting/schedules" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "'"$BENEFICIARY_ADDRESS"'",
    "totalAmount": "10000000",
    "cliffDuration": 3600,
    "vestingDuration": 86400,
    "vestingType": "team",
    "notes": "Test vesting schedule"
  }'
```

### Expected Response (201 Created)
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "beneficiaryAddress": "GABC...",
    "totalAmount": "10000000",
    "claimedAmount": "0",
    "cliffEnd": 1735689600,
    "vestingEnd": 1735776000,
    "start": 1735686000,
    "status": "active",
    "vestingType": "team",
    "claimableNow": "0",
    "claimablePercent": 0,
    "isCliffPassed": false,
    "isFullyVested": false,
    "contractAddress": "CABC...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Test 2: Validation - Cliff Too Short

### Request
```bash
curl -X POST "$API_URL/admin/vesting/schedules" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "'"$BENEFICIARY_ADDRESS"'",
    "totalAmount": "10000000",
    "cliffDuration": 1800,
    "vestingDuration": 86400,
    "vestingType": "team"
  }'
```

### Expected Response (422 Unprocessable Entity)
```json
{
  "error": "Cliff duration must be 0 or at least 3600 seconds (1 hour)"
}
```

## Test 3: Validation - Vesting Too Short

### Request
```bash
curl -X POST "$API_URL/admin/vesting/schedules" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "'"$BENEFICIARY_ADDRESS"'",
    "totalAmount": "10000000",
    "cliffDuration": 0,
    "vestingDuration": 3600,
    "vestingType": "team"
  }'
```

### Expected Response (422 Unprocessable Entity)
```json
{
  "error": "Vesting duration must be at least 86400 seconds (1 day)"
}
```

## Test 4: Get All Schedules (Admin)

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules?status=active&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "beneficiaryAddress": "GABC...",
      "totalAmount": "10000000",
      "status": "active",
      "vestingType": "team",
      "claimableNow": "0",
      "claimablePercent": 0
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 10,
    "offset": 0
  }
}
```

## Test 5: Get Schedule by ID

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules/1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "beneficiaryAddress": "GABC...",
    "totalAmount": "10000000",
    "claimedAmount": "0",
    "cliffEnd": 1735689600,
    "vestingEnd": 1735776000,
    "status": "active",
    "vestingType": "team",
    "notes": "Test vesting schedule",
    "claimableNow": "0",
    "claimablePercent": 0
  }
}
```

## Test 6: Get My Schedules (Beneficiary)

### Request
```bash
curl -X GET "$API_URL/vesting/my-schedules" \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "beneficiaryAddress": "GABC...",
      "totalAmount": "10000000",
      "claimedAmount": "0",
      "claimableNow": "0",
      "claimablePercent": 0,
      "isCliffPassed": false,
      "isFullyVested": false,
      "status": "active"
    }
  ]
}
```

## Test 7: Get Schedules by Address (Public)

### Request
```bash
curl -X GET "$API_URL/vesting/schedules/by-address/$BENEFICIARY_ADDRESS"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "beneficiaryAddress": "GABC...",
      "totalAmount": "10000000",
      "claimedAmount": "0",
      "status": "active"
    }
  ]
}
```

## Test 8: Claim Before Cliff

### Request
```bash
curl -X POST "$API_URL/vesting/schedules/1/claim" \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Expected Response (400 Bad Request)
```json
{
  "error": "No tokens available to claim yet"
}
```

## Test 9: Claim After Cliff (Success)

**Note**: Wait until cliff period has passed, or use testnet time manipulation

### Request
```bash
curl -X POST "$API_URL/vesting/schedules/1/claim" \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "amountClaimed": "2500000",
    "claimedAt": "2024-01-02T00:00:00.000Z",
    "txHash": "abc123...",
    "beneficiaryAddress": "GABC..."
  }
}
```

## Test 10: Get Claim History

### Request
```bash
curl -X GET "$API_URL/vesting/schedules/1/claims" \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "amountClaimed": "2500000",
      "claimedAt": "2024-01-02T00:00:00.000Z",
      "txHash": "abc123...",
      "beneficiaryAddress": "GABC..."
    }
  ]
}
```

## Test 11: Unauthorized Claim Attempt

### Request
```bash
# Try to claim someone else's schedule
curl -X POST "$API_URL/vesting/schedules/1/claim" \
  -H "Authorization: Bearer $OTHER_USER_TOKEN"
```

### Expected Response (403 Forbidden)
```json
{
  "error": "Unauthorized: not the beneficiary of this schedule"
}
```

## Test 12: Revoke Schedule (Admin)

### Request
```bash
curl -X DELETE "$API_URL/admin/vesting/schedules/1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Employee terminated"
  }'
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "message": "Vesting schedule revoked successfully"
}
```

## Test 13: Verify Revoked Status

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules/1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "status": "revoked",
    "revokedAt": "2024-01-03T00:00:00.000Z",
    "notes": "Test vesting schedule\n\nRevoked: Employee terminated"
  }
}
```

## Test 14: Cannot Claim from Revoked Schedule

### Request
```bash
curl -X POST "$API_URL/vesting/schedules/1/claim" \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Expected Response (400 Bad Request)
```json
{
  "error": "Cannot claim from revoked schedule"
}
```

## Test 15: Filter Schedules by Type

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules?vestingType=team&status=active" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "vestingType": "team",
      "status": "active"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

## Test 16: Missing Authorization

### Request
```bash
curl -X GET "$API_URL/vesting/my-schedules"
# No Authorization header
```

### Expected Response (401 Unauthorized)
```json
{
  "error": "Unauthorized"
}
```

## Test 17: Non-Admin Access to Admin Endpoint

### Request
```bash
curl -X POST "$API_URL/admin/vesting/schedules" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "GABC...",
    "totalAmount": "10000000",
    "cliffDuration": 3600,
    "vestingDuration": 86400,
    "vestingType": "team"
  }'
```

### Expected Response (403 Forbidden)
```json
{
  "error": "Forbidden: Admin access required"
}
```

## Test 18: Invalid Schedule ID

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules/999999" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (404 Not Found)
```json
{
  "error": "Schedule not found"
}
```

## Test 19: Create Schedule with User Link

### Request
```bash
curl -X POST "$API_URL/admin/vesting/schedules" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "GABC...",
    "beneficiaryUserId": "550e8400-e29b-41d4-a716-446655440000",
    "totalAmount": "50000000",
    "cliffDuration": 7776000,
    "vestingDuration": 31536000,
    "vestingType": "advisor",
    "notes": "Strategic advisor - onboarded Q1 2024"
  }'
```

### Expected Response (201 Created)
```json
{
  "success": true,
  "data": {
    "scheduleId": 2,
    "beneficiaryUserId": "550e8400-e29b-41d4-a716-446655440000",
    "vestingType": "advisor"
  }
}
```

## Test 20: Pagination

### Request
```bash
curl -X GET "$API_URL/admin/vesting/schedules?limit=5&offset=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Expected Response (200 OK)
```json
{
  "success": true,
  "data": [ /* 5 schedules */ ],
  "pagination": {
    "total": 50,
    "limit": 5,
    "offset": 10
  }
}
```

## Performance Tests

### Bulk Schedule Creation
Create 100 schedules and measure time:

```bash
for i in {1..100}; do
  curl -X POST "$API_URL/admin/vesting/schedules" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "beneficiaryAddress": "GABC...",
      "totalAmount": "10000000",
      "cliffDuration": 3600,
      "vestingDuration": 86400,
      "vestingType": "team",
      "notes": "Bulk test schedule '$i'"
    }' &
done
wait
```

### List All Schedules Performance
```bash
time curl -X GET "$API_URL/admin/vesting/schedules?limit=1000" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Database Verification

After each test, verify in PostgreSQL:

```sql
-- Check schedule was created
SELECT * FROM vesting_schedules WHERE schedule_id = 1;

-- Check claim was recorded
SELECT * FROM vesting_claims WHERE schedule_id = 1;

-- Check sync logs
SELECT * FROM vesting_sync_log ORDER BY sync_started_at DESC LIMIT 5;
```

## Notes

- All timestamps are Unix timestamps (seconds since epoch)
- Amounts are in stroops (1 XLM = 10,000,000 stroops)
- Bearer tokens must be valid JWTs with appropriate permissions
- Schedule IDs are auto-incremented integers
- Cliff and vesting durations are in seconds
