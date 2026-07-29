# Event Sourcing — Booking Aggregate

## Overview

MentorsMind uses an event store (`domain_events` + `snapshots`) alongside the
existing `bookings` table during a dual-write migration. Command handlers still
mutate the bookings read model directly, and also publish domain events via
`EventStoreService.publishEvent`. Registered projection handlers keep the read
model consistent and enable replay/rebuild.

## Components

| Piece | Path | Role |
|-------|------|------|
| Event store | `src/services/event-store.service.ts` | Append events, snapshots every 10 versions, dispatch projections |
| Projection bus | `src/services/projection.service.ts` | `registerHandler` / `handleEvent` |
| Booking reducer | `src/events/booking.reducer.ts` | Pure `applyBookingEvent(state, event)` |
| Booking projections | `src/events/booking.projections.ts` | Concrete read-model handlers |
| Dual-write | `src/services/bookings.service.ts` | Publishes events on create / confirm / complete / cancel |
| Startup | `src/server.ts` | Calls `registerBookingProjectionHandlers()` |

## Event types (Booking aggregate)

| Event | When published | Projection effect |
|-------|----------------|-------------------|
| `BookingCreated` | `createBooking` | Upsert booking row |
| `BookingStatusChanged` | `confirmBooking`, `completeBooking` | Update `status` / `payment_status` |
| `BookingCancelled` | `cancelBooking` | Set cancelled + reason; enqueue refund (`refund:booking:{id}`) |

Aggregate type string: **`Booking`**.

## Snapshot strategy

`SNAPSHOT_THRESHOLD = 10`. When `version % 10 === 0`, `EventStoreService` rebuilds
state with `applyBookingEvent` and stores it in `snapshots`. Snapshots at
versions 10, 20, 30 contain full booking fields (not `{}`).

Replay uses the latest snapshot + subsequent events (`EventStoreModel.replay`).

## Admin API

```
GET /api/v1/bookings/:id/events?limit=100&offset=0
```

Requires admin auth. Returns the event log in **version order** via
`EventStoreService.getEventHistory`.

Also available under `/api/v1/events/aggregate/:aggregateId/history`.

## Dual-write guarantees

- Primary booking DB writes remain authoritative for the HTTP response path.
- `publishEvent` failures are logged and do **not** roll back the booking mutation.
- Projection upserts use `ON CONFLICT` / `UPDATE` so replaying is idempotent.
- Refund jobs use stable BullMQ `jobId`s to avoid double refunds when both the
  service and the cancel projection enqueue.

## Adding handlers

```ts
import { ProjectionService } from '../services/projection.service';

ProjectionService.registerHandler('Booking', 'MyEvent', async (event) => {
  // update a read model
});
```

Register at startup (see `src/server.ts`) so `ProjectionService.getHandlerCount()` ≥ 3
before the server accepts traffic.
