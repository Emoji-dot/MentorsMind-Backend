# MentorMinds Backend Testing Strategy

This repository uses Jest and `ts-jest` for automated testing. Our goal is to maintain a minimum of 80% line coverage for critical services and have reliable integration tests using `testcontainers`.

## Unit Tests

Unit tests focus on isolated business logic without hitting external dependencies, the database, or the blockchain.
All external calls are mocked using Jest's mocking capabilities.

- **Location**: `src/**/__tests__/*.test.ts`
- **Command**: `pnpm test`
- **Coverage**: `pnpm test:cov`

### Mocking Guidelines

- Always use `jest.mock()` at the top of your test file to mock dependencies such as database models, cache services, and external APIs (like `SorobanEscrowService` and `AssetExchangeService`).
- Avoid mocking standard node built-ins unless necessary.
- Ensure to `jest.clearAllMocks()` in your `beforeEach` block.

## Integration Tests

Integration tests cover the full lifecycle of an API flow, hitting the Express server (`supertest`), connecting to a real PostgreSQL instance and a Redis instance (via `testcontainers`). External services (Stellar/Soroban) should still be mocked.

- **Location**: `tests/integration/*.test.ts`
- **Command**: `pnpm test:integration`

### Testcontainers Setup

The `tests/integration/setup.ts` file automatically spins up isolated instances of Postgres and Redis before the tests run and tears them down afterwards. Keep in mind that the initial run may be slower while Docker downloads the required images.

## CI/CD Pipeline

The test suite runs automatically on GitHub Actions (see `.github/workflows/deploy.yml`) on every push to `main` and all Pull Requests. It ensures that tests pass before the deployment step can proceed.
