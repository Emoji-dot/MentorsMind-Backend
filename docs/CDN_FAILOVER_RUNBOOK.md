# CDN Failover Runbook

## Overview

This runbook documents how MentorsMind handles CDN provider outages and provides operational procedures for recovery.

## Architecture

### Health Monitoring

- **Health Check Interval**: 60 seconds
- **Health Check Endpoint**: `HEAD /health-check-asset.txt` on each CDN domain
- **Health Storage**: Redis cache with 60-second TTL
- **Timeout**: 5 seconds per health check

### Circuit Breaker

Each CDN domain has an independent circuit breaker:

- **Failure Threshold**: 3 consecutive failed health checks
- **Circuit State**: OPEN (unhealthy) after threshold reached
- **Circuit Cooldown**: 5 minutes
- **Auto-recovery**: After cooldown, circuit attempts to close

### Domain Selection

- `getAssetUrl()` automatically selects the healthiest domain
- Selection criteria (in order):
  1. Filter to healthy domains only
  2. Choose the fastest healthy domain by latency
  3. Fallback to first domain if all are unhealthy

### Failed Invalidation Retry

When CDN invalidation fails (e.g., API down):

- Failed invalidations are queued in `cdn_invalidation_queue` table
- BullMQ worker retries every 5 minutes
- Retry period: 24 hours (288 attempts × 5 minutes)
- Status tracking: pending → completed/failed

## Monitoring

### Health Endpoint

```
GET /api/v1/admin/cdn/health
```

Response:
```json
{
  "cdn.cloudfront.net": {
    "domain": "cdn.cloudfront.net",
    "healthy": true,
    "latencyMs": 45,
    "lastChecked": "2024-07-29T10:15:30.000Z",
    "circuitOpen": false
  },
  "cdn.cloudflare.com": {
    "domain": "cdn.cloudflare.com",
    "healthy": false,
    "latencyMs": 5001,
    "lastChecked": "2024-07-29T10:15:25.000Z",
    "circuitOpen": true
  }
}
```

### Invalidation Queue Stats

```
GET /api/v1/admin/cdn/invalidation-queue/stats
```

Response:
```json
{
  "queue": {
    "waiting": 15,
    "active": 2,
    "completed": 523,
    "failed": 3,
    "delayed": 0,
    "total": 543
  },
  "database": {
    "pending": 15,
    "completed": 520,
    "failed": 3
  }
}
```

### Prometheus Metrics

- `cdn_domain_health{domain="..."}` - 1 if healthy, 0 if unhealthy (gauge)
- `cdn_domain_latency_ms{domain="..."}` - Response time in milliseconds (gauge)
- `cdn_invalidation_failures_total{provider="..."}` - Total failed invalidations (counter)

## Incident Response

### Scenario 1: Single CDN Domain Down (e.g., CloudFront)

**Timeline:**
- T+0s: First failed health check
- T+30s: Second failed health check
- T+60s: Third failed health check → Circuit opens
- T+60s: All `getAssetUrl()` calls switch to Cloudflare
- T+300s: 5-minute cooldown expires, circuit attempts to close

**Symptoms:**
- Health endpoint shows `circuitOpen: true` for affected domain
- Latency spikes in metrics for that domain

**Action:**
1. Verify the outage with your CDN provider
2. Monitor health endpoint to watch recovery
3. No manual action needed — automatic failover is active
4. Optional: Manually verify with health check endpoint:

   ```bash
   curl -X POST /api/v1/admin/cdn/health/check/cdn.cloudfront.net
   ```

### Scenario 2: All CDN Domains Down

**Symptoms:**
- Health endpoint shows all domains unhealthy
- `getAssetUrl()` falls back to first domain (will return 5xx responses)
- Mentor profile images and assets fail to load

**Action:**
1. **Page on-call CDN operations team immediately**
2. Monitor provider status page for ETA
3. Increase monitoring frequency (check health every 30 seconds manually)
4. Communicate with users if outage is >5 minutes
5. Consider degraded mode operations:
   - Disable asset-heavy features (profile images, lazy-load previews)
   - Serve static fallback images instead
   - Redirect asset requests to origin server

**To fallback to origin server:**

Update environment variable:
```bash
CDN_DOMAINS=https://origin.example.com,https://cdn1.example.com,https://cdn2.example.com
```

Restart app server to use new domain list.

### Scenario 3: Invalidation API Failures

**Symptoms:**
- `GET /api/v1/admin/cdn/invalidation-queue/stats` shows high `failed` count
- Stale cache after deployment
- Database shows `status='failed'` entries in `cdn_invalidation_queue`

**Action:**
1. Check CDN provider API status
2. Review error messages in database:
   ```sql
   SELECT id, paths, provider, error_message, attempt, updated_at
   FROM cdn_invalidation_queue
   WHERE status = 'failed'
   ORDER BY updated_at DESC
   LIMIT 10;
   ```

3. If provider is down:
   - Invalidations will auto-retry every 5 minutes for 24 hours
   - No action needed, queue will drain as provider recovers

4. If provider API has changed:
   - Update `invalidateCloudFront()`, `invalidateCloudflare()`, etc. functions
   - Manual retry after fix:
     ```sql
     UPDATE cdn_invalidation_queue
     SET status = 'pending', attempt = 0
     WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour';
     ```

## Manual Recovery

### Manually Clear Circuit Breaker

If a domain has recovered but circuit is still open:

```bash
curl -X POST /api/v1/admin/cdn/health/clear/cdn.cloudfront.net
```

This:
- Clears the circuit breaker flag
- Resets failure count
- Allows next health check to re-evaluate

### Force Health Check

To immediately check a domain's health without waiting for the 60-second interval:

```bash
curl -X POST /api/v1/admin/cdn/health/check/cdn.cloudfront.net
```

### Re-queue Failed Invalidations

If you've fixed the CDN provider issue and want to retry:

```sql
UPDATE cdn_invalidation_queue
SET status = 'pending', attempt = 0, error_message = NULL
WHERE status = 'failed' AND provider = 'cloudfront';
```

The BullMQ worker will pick them up on the next cycle.

## Performance Baselines

- Single domain health check: <100ms (typical)
- Health check timeout: 5 seconds
- Background health checks: Every 60 seconds
- Invalidation retry: Every 5 minutes
- Domain selection overhead: <5ms (Redis lookup)

## Testing

### Test Circuit Breaker

```bash
# Stop one CDN domain (update firewall or route)
# Observe 3 health check failures
# Verify circuit opens and domain is removed from getAssetUrl() pool
```

### Test Failover

```bash
# Deploy with multiple CDN domains
# Use health endpoint to verify domains are healthy
# Stop primary domain
# Verify getAssetUrl() automatically switches to second domain
```

### Test Invalidation Retry

```bash
# Deploy code that invalidates /images/test.jpg
# Monitor database:
#   INSERT → status='pending'
#   → Retry attempts every 5 minutes
#   → Eventually status='completed' or status='failed' after 24h
```

## Metrics to Monitor

- **cdn_domain_health**: Should be 1 (healthy) for all domains
- **cdn_domain_latency_ms**: Should be <200ms for all domains
- **cdn_invalidation_failures_total**: Should stay flat (no new failures)
- **getAssetUrl() call latency**: Should be <10ms even under load

## Related Documentation

- [CDN Configuration](../docs/cdn-configuration.md)
- [Monitoring and Observability](../docs/monitoring.md)
- [Disaster Recovery](../docs/disaster-recovery.md)

## Support

For questions or issues:
1. Check health endpoint: `/api/v1/admin/cdn/health`
2. Review logs for "CDN health check" messages
3. Escalate to CDN provider support if health checks are passing but assets still fail
