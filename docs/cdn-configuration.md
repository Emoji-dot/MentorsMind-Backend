# CDN Configuration Guide — Issue #745

Geo-distributed CDN setup for MentorsMind Backend: static assets + API response caching.

## Overview

Three files implement CDN support:

| File | Purpose |
|------|---------|
| `src/config/cdn-geo.config.ts` | Provider-specific config (CloudFront, Cloudflare, Fastly) + cache strategies |
| `src/middleware/smart-cdn-headers.middleware.ts` | Applies correct `Cache-Control`, `Vary`, `Surrogate-Control`, and cache tag headers |
| `src/services/cdn.service.ts` | URL rewriting, image optimisation, cache invalidation API |

## Cache Strategies

| Strategy | `max-age` | `stale-while-revalidate` | `Surrogate-Control` | Use case |
|----------|-----------|-------------------------|---------------------|----------|
| `staticImmutable` | 1 year | — | — | Hash-named assets (`/static/*`) |
| `static` | 30 days | 1 day | — | Versioned assets |
| `images` | 1 day | 1 hour | 7 days | `/assets/images/*` |
| `videos` | 7 days | 1 day | 30 days | `/assets/videos/*` |
| `apiPublic` | 1 min | 5 min | 5 min | Generic public API |
| `apiListings` | 30 sec | 2 min | 2 min | `/api/v1/mentors` |
| `apiAnalytics` | 5 min | 10 min | 10 min | `/api/v1/analytics` |
| `apiAuthenticated` | 0 | — | — | Any route with `Authorization` header |
| `noCache` | 0 (no-store) | — | — | Health checks, webhooks |

## Middleware usage

### Global (recommended)

Mount after auth middleware so `req.user` is available for auth-bypass logic:

```typescript
// src/app.ts
import { smartCdnHeaders } from './middleware/smart-cdn-headers.middleware';

app.use(authenticate);         // set req.user
app.use(smartCdnHeaders());    // set Cache-Control based on auth state
app.use(router);
```

### Per-route

```typescript
import {
  apiPublicCdnHeaders,
  immutableCdnHeaders,
  noCdnCache,
} from '../middleware/smart-cdn-headers.middleware';

// Public listing — 30s browser / 2min edge TTL
router.get('/mentors', apiPublicCdnHeaders(), listMentors);

// Static assets with content hash in filename
router.use('/static', immutableCdnHeaders(), express.static(distDir));

// Webhooks / mutations — never cache
router.post('/webhooks/stripe', noCdnCache(), stripeWebhookHandler);
```

## Provider setup

### CloudFront (AWS)

```bash
# Required env vars
CDN_PROVIDER=cloudfront
CDN_BASE_URL=https://d1234abcdef.cloudfront.net
CDN_CLOUDFRONT_DISTRIBUTION_ID=E1234ABCDEF
AWS_REGION=us-east-1
```

The `getCloudFrontConfig()` function returns a full distribution configuration object.
Use it with the AWS CDK or Terraform `aws_cloudfront_distribution` resource.

Key settings:
- `PriceClass_All` — uses all global edge locations for lowest latency worldwide
- HTTP/2 + HTTP/3 enabled
- Gzip + Brotli compression enabled
- Per-path cache behaviours with tailored TTLs (see `cacheBehaviours` array)

### Cloudflare

```bash
CDN_PROVIDER=cloudflare
CDN_BASE_URL=https://assets.mentorminds.com
CDN_CLOUDFLARE_ZONE_ID=your_zone_id
CDN_CLOUDFLARE_API_TOKEN=your_api_token
```

Cache rules from `getCloudflareConfig()` should be applied via the Cloudflare dashboard
or Terraform `cloudflare_ruleset` resource. Key rules:
- `Authorization` header present → bypass cache (private route protection)
- `/static/*` → 1 year edge TTL
- `/api/v1/mentors` GET → 2 min edge TTL

Enable **Tiered Cache** (Argo) in Cloudflare dashboard for geo-distributed origin shielding.

### Fastly

```bash
CDN_PROVIDER=fastly
CDN_BASE_URL=https://assets.mentorminds.com
CDN_FASTLY_SERVICE_ID=your_service_id
CDN_FASTLY_API_KEY=your_api_key
```

`getFastlyConfig()` returns VCL snippets and surrogate key group definitions.
Upload VCL via the Fastly API or Terraform `fastly_service_vcl` resource.

## Cache invalidation

### Via API (admin only)

```bash
POST /api/v1/cdn/invalidate
Authorization: Bearer <admin_token>
Content-Type: application/json

{ "paths": ["/api/v1/mentors", "/assets/emails/*"] }
```

### Via cache tags (Cloudflare / Fastly)

Every public response receives `Cache-Tag` and `Surrogate-Key` headers.
Purge by tag without a full cache flush:

```bash
# Cloudflare
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -d '{"tags":["mentor-listings"]}'

# Fastly
curl -X POST "https://api.fastly.com/service/$SERVICE_ID/purge" \
  -H "Fastly-Key: $FASTLY_KEY" \
  -H "Surrogate-Key: mentor-listings"
```

## API response caching

Public endpoints that are safe to cache at the CDN edge:

| Endpoint | TTL (browser) | TTL (CDN edge) | Auth bypass |
|----------|---------------|----------------|-------------|
| `GET /api/v1/mentors` | 30s | 2 min | Yes (private when authed) |
| `GET /api/v1/timezones` | 30 days | — | No |
| `GET /api/v1/analytics/*` | 5 min | 10 min | Yes |
| `GET /api/v1/platform-health` | 1 min | 5 min | No |
| `GET /health` | no-store | bypass | No |

All other routes default to `private, no-cache`.
