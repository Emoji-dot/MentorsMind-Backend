# Chaos Engineering and Resilience Testing

This repository now includes a structured chaos engineering practice to validate failure modes proactively and improve system resilience.

## What is included

- `src/tests/chaos/scenarios.ts` — a catalog of failure injection scenarios
- `src/tests/chaos/engine.ts` — a lightweight chaos injector for unit tests and resilience checks
- `src/__tests__/chaos/chaos-engine.unit.test.ts` — automated tests exercising failure injection behavior

## Chaos scenarios

1. Database Connection Loss
   - type: `outage`
   - target: `postgresql`
   - expected behavior: graceful degradation with cached data
   - acceptable degradation: read-only mode for 30s

2. External Search Latency
   - type: `latency`
   - target: `elasticsearch`
   - expected behavior: fallback search mode
   - acceptable degradation: response latency up to 2s

3. External Payment Gateway Failure
   - type: `error`
   - target: `payment-gateway`
   - expected behavior: retry logic or safe failure notice
   - acceptable degradation: payment delay up to 30s

4. Cache Service Resource Pressure
   - type: `resource`
   - target: `redis`
   - expected behavior: fallback to safe defaults or cache bypass
   - acceptable degradation: up to 50% slower responses

5. Email Provider Outage
   - type: `outage`
   - target: `smtp`
   - expected behavior: queue outbound messages and retry
   - acceptable degradation: email delay up to 5 minutes

## Recommended testing schedule

- Weekly: simulate one low-impact scenario such as search latency or cache pressure.
- Monthly: simulate a medium-impact scenario such as a payment gateway failure or Redis saturation.
- Quarterly: perform a full outage drill for a critical dependency such as PostgreSQL or SMTP.

## Running chaos tests

Use the dedicated npm command to run the failure injection harness and verify resilience logic.

```bash
npm run test:chaos
```

## Failure mode documentation

Each scenario includes expected behavior and acceptable degradation definitions so developers can validate resilience outcomes.

## Circuit breaker and retry validation

- `error` and `outage` scenarios confirm that error-handling paths are exercised.
- `latency` scenarios verify that timing-related fallbacks remain functional.
- `resource` scenarios validate that overloaded dependency handling does not crash the service.
