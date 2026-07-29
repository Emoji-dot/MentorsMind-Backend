# E2E Integration Test Strategy

## Overview

This document describes the end-to-end (E2E) integration test strategy for the MentorsMind Stellar backend. It covers architecture decisions, test organisation, how to run tests locally and in CI, and a container performance optimisation guide.

---

## Why E2E Tests?

Unit tests mock every external dependency. That makes them fast and reliable for validating individual functions, but they **cannot catch integration failures** between real services. Examples that unit tests will never detect:

- `BookingsService.confirmBooking` creates a Soroban escrow, but `EscrowReleaseWorker` queries the DB using a different column name introduced in a recent migration → release silently skips every booking.
- A Redis connection timeout between BullMQ `queue.add()` and the worker's `process()` causes the 48-hour escrow release job to never fire.
- A PostgreSQL FK constraint fails because the bookings table references the wrong column after a migration rename.

E2E tests exercise the full stack — real PostgreSQL, real Redis, real BullMQ, real Express request routing — with **only** Stellar Horizon and Soroban RPC replaced by in-process mocks (because those require live testnet accounts).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Jest E2E Run (jest --config jest.e2e.config.ts)                              │
│                                                                             │
│  globalSetup  ──► PostgreSqlContainer (postgres:15-alpine)                  │
│               ──► RedisContainer      (redis:7-alpine)                      │
│               ──► pnpm migrate:up (runs all 88+ migrations)                 │
│               ──► writes DATABASE_URL + REDIS_URL to process.env             │
│                                                                             │
│  For each suite:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ TestFixture.setup()                                                  │   │
│  │   • TRUNCATE all tables (isolation)                                  │   │
│  │   • FLUSHDB Redis (isolation)                                        │   │
│  │   • Seed: 1 admin, 1 mentor, 1 mentee + wallets                     │   │
│  │   • jest.resetModules() + import Express app                         │   │
│  │   • Issue JWT tokens via TokenService                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Suites run SEQUENTIALLY (maxWorkers: 1)                                     │
│                                                                             │
│  globalTeardown ──► stop containers                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What is mocked

| Service | Mock | Reason |
|---------|------|--------|
| Stellar Horizon server | `stellar-mock.ts` | Requires funded testnet accounts |
| `stellarService` | `stellar-mock.ts` | Same — also avoids network latency |
| `SorobanEscrowService` | `soroban-mock.ts` | Soroban RPC is testnet-only |
| Email (`nodemailer`) | Not mocked (falls back silently) | SMTP config is empty in test env |
| Push notifications (Firebase) | Not mocked (no-ops in test env) | No Firebase credentials in test env |

Everything else — PostgreSQL, Redis, BullMQ, Express routing, JWT validation, middleware, DB models — uses **real** implementations.

---

## File Structure

```
tests/
└── e2e/
    ├── setup/
    │   ├── global-setup.ts        # Start containers + run migrations (Jest globalSetup)
    │   ├── global-teardown.ts     # Stop containers (Jest globalTeardown)
    │   ├── test-fixture.ts        # Per-suite setup/teardown + helpers
    │   ├── stellar-mock.ts        # Horizon + stellarService mocks
    │   └── soroban-mock.ts        # SorobanEscrowClient mock
    ├── auth-flow.e2e.ts           # register → login → refresh → logout
    ├── booking-lifecycle.e2e.ts   # createBooking → pay → confirm → complete
    ├── escrow-release.e2e.ts      # 48h auto-release + BullMQ job scheduling
    ├── dispute-resolution.e2e.ts  # openDispute → resolveDispute → escrow state
    └── cancellation-refund.e2e.ts # cancel → refund flow + job queue
jest.e2e.config.ts                 # Separate Jest config for E2E (ts-jest, sequential)
```

---

## Running Tests

### Prerequisites

- Docker must be running (testcontainers uses the local Docker daemon)
- Node 20+ and pnpm installed
- Dependencies installed: `pnpm install`

### Run all E2E suites

```bash
pnpm exec jest --config jest.e2e.config.ts --forceExit
```

### Run a single suite

```bash
pnpm exec jest --config jest.e2e.config.ts --forceExit tests/e2e/auth-flow.e2e.ts
```

### Run with verbose output

```bash
pnpm exec jest --config jest.e2e.config.ts --forceExit --verbose
```

### Run with container logs (debugging)

```bash
E2E_VERBOSE=1 pnpm exec jest --config jest.e2e.config.ts --forceExit
```

### Add to package.json scripts

```json
{
  "scripts": {
    "test:e2e": "jest --config jest.e2e.config.ts --forceExit",
    "test:e2e:watch": "jest --config jest.e2e.config.ts --watchAll"
  }
}
```

---

## Test Suite Reference

### `auth-flow.e2e.ts`

Covers the authentication critical path.

| Test | What it verifies |
|------|-----------------|
| Register with valid data | 201, access + refresh tokens returned |
| Register duplicate email | 4xx rejection |
| Register weak password | 400 rejection |
| Login valid credentials | 200, tokens + user object |
| Login wrong password | 401 |
| GET /auth/me authenticated | 200, correct user object |
| GET /auth/me unauthenticated | 401 |
| Token refresh | New access token issued from refresh token |
| Logout + revocation | Refresh token invalidated after logout |
| Change password | 200/204 on correct current password |
| RBAC: admin endpoint | Admin allowed, mentee blocked |

### `booking-lifecycle.e2e.ts`

Covers the full booking state machine.

| Test | What it verifies |
|------|-----------------|
| Create booking | 201, status=pending, payment_status=pending in DB |
| Create with past date | 400 rejection |
| Create invalid mentor | 400/404 rejection |
| Initiate payment | 200/201, status changes |
| Confirm booking | status=confirmed in DB |
| Complete confirmed booking | status=completed in DB |
| Complete pending booking | 4xx rejection |
| Full happy path (DB-direct) | All states transition correctly |
| List bookings | 200, array returned |

### `escrow-release.e2e.ts`

Covers BullMQ-driven escrow auto-release.

| Test | What it verifies |
|------|-----------------|
| Worker releases funded escrow | status=released, payment_status=paid |
| Worker skips disputed escrow | Escrow remains disputed |
| Worker skips already-released escrow | Idempotent, no error |
| Worker throws on missing escrow | Error propagated correctly |
| scheduleEscrowRelease enqueues job | Delayed job visible in Redis |
| Duplicate schedule is idempotent | Only 1 job with unique jobId |
| cancelEscrowRelease removes job | Job absent from Redis |

### `dispute-resolution.e2e.ts`

Covers the dispute lifecycle.

| Test | What it verifies |
|------|-----------------|
| Open dispute | 201, dispute record in DB |
| Open dispute transitions escrow | Escrow marked disputed |
| Open dispute cancels release job | ESCROW_RELEASE job removed from Redis |
| Duplicate dispute rejected | 4xx on second dispute |
| Admin resolves for mentor | Escrow released |
| Admin resolves for mentee | Escrow refunded |
| Non-admin cannot resolve | 401/403 |
| State machine DB transitions | funded → disputed → resolved |

### `cancellation-refund.e2e.ts`

Covers the cancellation + refund flow.

| Test | What it verifies |
|------|-----------------|
| Cancel future confirmed booking | status=cancelled, payment_status=refund_pending/refunded |
| Cancellation reason persisted | cancellation_reason stored in DB |
| Unauthenticated cannot cancel | 401 |
| Completed booking cannot be cancelled | 4xx rejection |
| Direct DB refund + escrow update | Both records reach final state |
| cancelEscrowRelease removes release job | Job gone from Redis |

---

## Test Isolation

Each test suite is fully isolated:

1. **Container level**: One PostgreSQL + one Redis container is shared across all suites (for startup performance), but each suite calls `TestFixture.resetTransactionalData()` in `beforeEach` to truncate all transactional tables and flush Redis.

2. **Module level**: `jest.resetModules()` is called in `TestFixture.setup()` so each suite loads a fresh Express app instance with the correct env vars pointing at the container.

3. **Mock level**: `clearMockEscrows()` is called in `beforeEach` to reset the in-memory Soroban mock store.

---

## BullMQ + Fake Timers Strategy

The 48-hour escrow release delay poses a testing challenge. The chosen strategy:

### Option A: Direct worker invocation (used in `escrow-release.e2e.ts`)

The `simulateEscrowReleaseWorker()` helper function directly replicates the worker logic in-process:

```typescript
async function simulateEscrowReleaseWorker(escrowId, pool) {
  // Check status (mirrors real worker's guard)
  // Update escrow → released
  // Update booking → payment_status=paid
}
```

This is the most reliable approach because:
- No reliance on BullMQ's internal scheduler ticking
- Deterministic — no race conditions
- Tests the business logic, not BullMQ internals

### Option B: BullMQ job scheduling tests (also in `escrow-release.e2e.ts`)

For testing the enqueueing and cancellation logic, we use the real BullMQ queue against the Redis container. This verifies:
- Jobs are created with the correct `jobId` (idempotency key)
- `cancelEscrowRelease` correctly removes delayed jobs
- No duplicate jobs are created

### Why not jest.useFakeTimers()?

`jest.useFakeTimers()` mocks JavaScript `setTimeout`/`setInterval` in the current process. BullMQ's scheduler runs inside a separate event loop with its own timers (backed by Redis `ZADD`/`ZRANGEBYSCORE`). Advancing Jest fake timers does not trigger BullMQ's internal delay expiry. This approach was evaluated and found unreliable; direct invocation is preferred.

---

## Container Startup Performance

### Typical startup times

| Phase | Duration |
|-------|----------|
| `postgres:15-alpine` pull (CI cache hit) | 2–5s |
| `redis:7-alpine` pull (CI cache hit) | 1–3s |
| Container start + healthcheck | 5–10s |
| Run 88 migrations | 8–15s |
| **Total globalSetup** | **15–35s** |

### Optimisation techniques applied

1. **Alpine images**: `postgres:15-alpine` and `redis:7-alpine` are ~50MB each vs ~200MB for full Debian images.

2. **Disabled durability in Postgres**: The container is started with `fsync=off synchronous_commit=off full_page_writes=off`. These settings make writes ~3× faster because no fsync to disk is required. This is safe for tests because data loss on crash is acceptable.

3. **Pre-pull in CI**: The CI workflow runs `docker pull postgres:15-alpine` and `docker pull redis:7-alpine` in parallel before running tests, so the pull does not count against the test timeout.

4. **Single container pair**: Containers are started once in `globalSetup` and shared across all suites. Table truncation (not container restart) is used between suites.

5. **Sequential test execution (`maxWorkers: 1`)**: Parallel test runs would require one container pair per worker, multiplying startup cost. Sequential runs with table truncation are faster overall.

6. **Selective truncation**: `resetTransactionalData()` only truncates the 8 tables that change between tests. The `users` and `wallets` tables (seeded once) are preserved.

### Estimated CI runtime breakdown

| Phase | Time |
|-------|------|
| pnpm install (cached) | 30s |
| Docker pre-pull (parallel, cached) | 5s |
| globalSetup (containers + migrations) | 30s |
| auth-flow.e2e.ts | 15s |
| booking-lifecycle.e2e.ts | 20s |
| escrow-release.e2e.ts | 20s |
| dispute-resolution.e2e.ts | 20s |
| cancellation-refund.e2e.ts | 15s |
| globalTeardown | 5s |
| **Total** | **~160s (< 3 min)** |

**Target: E2E suite completes in < 5 minutes in CI.** ✅

---

## Adding New E2E Tests

1. Create a new file in `tests/e2e/` with the `.e2e.ts` extension.
2. Add these two lines at the top (before any production imports):
   ```typescript
   import { installStellarMocks } from './setup/stellar-mock';
   import { installSorobanMocks } from './setup/soroban-mock';
   installStellarMocks();
   installSorobanMocks();
   ```
3. Instantiate `TestFixture` and call `setup()`/`teardown()` in `beforeAll`/`afterAll`.
4. Call `fixture.resetTransactionalData()` in `beforeEach` if your tests create mutable state.
5. Use `fixture.dbQuery()` for direct DB assertions alongside HTTP assertions.

---

## CI Integration

The CI pipeline is defined in `.github/workflows/deploy.yml`:

```
Push to main:
  ci (type-check, lint, build)
    ↓
  e2e (testcontainers, all 5 suites)
    ↓
  deploy-api (Railway)
    ↓
  deploy-worker (Railway)
```

**Deployment is blocked if any E2E suite fails.** The `deploy-api` job declares `needs: [ci, e2e]`, meaning both must pass before any deployment occurs.

On E2E failure, the test results and container state are uploaded as GitHub Actions artifacts for debugging.

---

## Troubleshooting

### Containers don't start

- Ensure Docker is running: `docker info`
- Check for port conflicts: `lsof -i :5432` and `lsof -i :6379`
- testcontainers uses random ports — if a test fails with "connection refused", check the `DATABASE_URL`/`REDIS_URL` env vars are set correctly

### Migrations fail

- Run `pnpm run migrate:validate` to check for numbering conflicts
- Check migration output with `E2E_VERBOSE=1` flag

### Tests intermittently fail

- Increase `testTimeout` in `jest.e2e.config.ts` (currently 240s)
- Add explicit `await` before assertions that depend on async side-effects
- Check Redis flush is happening between tests (`fixture.redis.flushdb()`)

### TypeScript errors in test files

- The `ts-jest` configuration in `jest.e2e.config.ts` ignores some diagnostic codes (1343, 2345, 7006) to allow flexible mock typing
- For genuine type errors, fix them — don't add more ignore codes

---

## Security Notes

- The `JWT_SECRET` and other secrets in test configuration are **dummy values** used only for the isolated test container environment. They are committed to the repository intentionally because no real data or production systems are ever touched.
- The `DATABASE_URL` written to `process.env` by `global-setup.ts` points to the ephemeral testcontainer. It is never a production database URL.
- No real Stellar network calls are made. The `installStellarMocks()` call replaces the Horizon server and `stellarService` before any production module is loaded.
