# Session No-Show Detection & Automatic Refund Policy

## Overview

The MentorsMind platform enforces a **10-minute grace period** for mentor attendance at scheduled sessions. If a mentor fails to join a confirmed session within this grace period, the booking is automatically flagged as a **no-show**, and the mentee receives a **full automatic refund** to their Stellar wallet via Soroban smart contract escrow.

This policy ensures platform reliability, protects mentee investments, and maintains accountability for mentors.

---

## How It Works

### 1. **Session Confirmation**
When a booking is confirmed by the mentor:
- Payment is held in **Soroban escrow** (on-chain)
- A **no-show detection job** is scheduled for `scheduled_start + 10 minutes`
- Both mentor and mentee receive confirmation notifications

### 2. **Grace Period**
- **Default grace period**: 10 minutes after `scheduled_start`
- Configurable via environment variable: `NO_SHOW_GRACE_PERIOD_MINUTES`
- Countdown begins at the exact scheduled start time

### 3. **Mentor Join Detection**
When a mentor joins the session (via WebSocket or API):
- `mentor_joined_at` timestamp is recorded in the database
- No-show detection job is **automatically cancelled**
- Session proceeds normally

**Join detection triggers:**
- WebSocket: `session:join` event
- REST API: `POST /api/v1/bookings/:id/join`
- Either method prevents no-show classification

### 4. **No-Show Classification**
At `scheduled_start + 10 minutes`, the worker checks:

✅ **Conditions for no-show:**
- Booking status is `confirmed`
- `mentor_joined_at` is `NULL`
- Mentor is **not currently online** (verified via presence service)

❌ **Conditions that prevent no-show:**
- Mentor has joined (timestamp exists)
- Booking status changed (cancelled, completed, etc.)
- Mentor is currently active/online

### 5. **Automatic Refund Process**
When a no-show is confirmed:

1. **Update booking status** to `no_show`
2. **Record detection time** in `no_show_detected_at`
3. **Initiate Soroban escrow refund** via `SorobanEscrowService.refund()`
4. **Store transaction hash** in `no_show_refund_tx_hash`
5. **Update payment status** to `refunded`
6. **Send notifications** to both parties

**Notification content:**
- **Mentee**: "Your mentor did not join. Full refund issued automatically."
- **Mentor**: "You missed a session. The mentee was refunded. Repeated no-shows may affect your account."

---

## API Endpoints

### **POST /api/v1/bookings/:id/join**
Mark the authenticated user as having joined the session.

**Authentication**: Required (Bearer token)

**Request**:
```http
POST /api/v1/bookings/123e4567-e89b-12d3-a456-426614174000/join
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Successfully joined session",
  "data": {
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "role": "mentor",
    "joinedAt": "2026-07-24T10:05:23.456Z",
    "isFirstJoin": true
  }
}
```

**Use cases**:
- Called automatically by client when entering meeting room
- Can be called manually by mentor before grace period expires
- Idempotent: repeated calls return existing `joinedAt` timestamp

---

### **GET /api/v1/bookings/:id/presence**
Get presence information for both session participants.

**Authentication**: Required (Bearer token)

**Request**:
```http
GET /api/v1/bookings/123e4567-e89b-12d3-a456-426614174000/presence
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "sessionId": "123e4567-e89b-12d3-a456-426614174000",
    "mentor": {
      "userId": "mentor-uuid",
      "joinedAt": "2026-07-24T10:05:23.456Z",
      "online": true
    },
    "mentee": {
      "userId": "mentee-uuid",
      "joinedAt": "2026-07-24T10:03:12.789Z",
      "online": true
    }
  }
}
```

**Use cases**:
- Display "waiting for mentor" UI in client
- Show connection status indicators
- Debug session attendance issues

---

## Database Schema

### **New Columns in `bookings` Table**

```sql
ALTER TABLE bookings ADD COLUMN mentor_joined_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN mentee_joined_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN no_show_detected_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bookings ADD COLUMN no_show_refund_tx_hash VARCHAR(255);
```

**Indexes**:
```sql
CREATE INDEX idx_bookings_no_show_detection 
ON bookings(status, scheduled_start, mentor_joined_at)
WHERE status = 'confirmed';
```

---

## Configuration

### **Environment Variables**

```bash
# Grace period in minutes (default: 10)
NO_SHOW_GRACE_PERIOD_MINUTES=10
```

### **Queue Configuration**

The no-show detection worker uses BullMQ with:
- **Queue**: `session-no-show-queue`
- **Concurrency**: 3 workers
- **Retry policy**: 5 attempts with exponential backoff
- **Job ID**: `no-show-check:{bookingId}` (idempotent)

---

## Architecture

### **Components**

1. **`session-no-show.queue.ts`**
   - Schedules delayed jobs for no-show checks
   - Provides `scheduleNoShowCheck()` and `cancelNoShowCheck()`

2. **`session-no-show.worker.ts`**
   - Background worker that processes no-show detection
   - Validates booking state, initiates refunds, sends notifications

3. **`presence.service.ts`**
   - Tracks session join times (`markSessionJoined()`)
   - Checks mentor online status (`isMentorActive()`)
   - Provides session presence queries

4. **`session-presence.controller.ts`**
   - REST API for manual join recording
   - Presence status queries

5. **`session-room.handler.ts` (WebSocket)**
   - Automatically records join time on `session:join` event
   - Cancels no-show check when mentor joins

### **Flow Diagram**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Booking Confirmed (BookingsService.confirmBooking)          │
│    - Schedule no-show job for scheduled_start + 10 minutes     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Grace Period (0-10 minutes after scheduled_start)           │
│                                                                 │
│    ┌─────────────────────┐         ┌──────────────────────┐   │
│    │ Mentor joins?       │───YES──▶│ Cancel no-show check │   │
│    │ (WebSocket/API)     │         │ Record joined_at     │   │
│    └─────────────────────┘         └──────────────────────┘   │
│              │                                                  │
│              NO                                                 │
│              ▼                                                  │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. No-Show Worker Runs (at scheduled_start + 10 minutes)       │
│    - Check booking.status = 'confirmed'                         │
│    - Check mentor_joined_at IS NULL                             │
│    - Check mentor NOT online                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. No-Show Confirmed                                            │
│    - Update booking.status = 'no_show'                          │
│    - Call SorobanEscrowService.refund()                         │
│    - Record no_show_refund_tx_hash                              │
│    - Send notifications (mentee + mentor)                       │
│    - Log audit trail                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling & Edge Cases

### **Idempotency**
- Worker uses booking status check to prevent duplicate refunds
- Job ID format: `no-show-check:{bookingId}` (prevents duplicate scheduling)
- Multiple calls to `/join` endpoint are safe (records first timestamp only)

### **Race Conditions**
- Worker queries database (not cache) for authoritative booking state
- Presence service uses Redis + PostgreSQL fallback
- No-show job cancellation is asynchronous but safe

### **Failed Refunds**
- Refund failures are logged but don't block notification delivery
- Manual intervention required if `SorobanEscrowService.refund()` fails
- Failed jobs are retained for dead-letter queue inspection

### **Mentee No-Shows**
- Mentee joining/not joining does NOT affect mentor no-show detection
- Only `mentor_joined_at` is used for no-show classification
- Future enhancement: track mentee attendance for analytics

### **Cancelled/Completed Sessions**
- Worker skips processing if booking status is not `confirmed`
- Status changes during grace period automatically prevent no-show classification

---

## Monitoring & Observability

### **Logs**

All no-show events are logged with structured metadata:

```typescript
logger.warn('No-show detected — initiating refund process', {
  bookingId: '...',
  mentorId: '...',
  menteeId: '...',
  scheduledStart: '...',
  gracePeriodMinutes: 10,
  noShowDetectedAt: '...',
});
```

### **Audit Trail**

Every no-show is recorded in the audit log:

```typescript
AuditLoggerService.logEvent({
  level: LogLevel.WARN,
  action: AuditAction.ADMIN_ACTION,
  message: 'Session no-show detected and processed',
  userId: 'system',
  entityType: 'booking',
  entityId: bookingId,
  metadata: {
    mentorId,
    menteeId,
    refundTxHash,
    trigger: 'auto-no-show-detection',
  },
});
```

### **Metrics to Track**

- **No-show rate per mentor**: `COUNT(no_show) / COUNT(confirmed)` by `mentor_id`
- **Average grace period utilization**: `AVG(mentor_joined_at - scheduled_start)`
- **False positive rate**: Manual review of no-show classifications
- **Refund success rate**: `COUNT(no_show_refund_tx_hash IS NOT NULL) / COUNT(no_show)`

### **Alerting**

**Recommended alerts:**
- Mentor no-show rate > 5% over 30 days
- No-show worker failures > 3 in 1 hour
- Refund failures > 1 in 1 hour
- Queue backlog > 100 delayed jobs

---

## SLA & Guarantees

### **Platform Commitments**

✅ **Detection latency**: No-show flagged within 1 minute of grace period expiry  
✅ **Refund latency**: Refund initiated within 1 minute of detection  
✅ **Notification latency**: Notifications sent within 2 minutes of detection  
✅ **False positive rate**: 0% (mentors who join are never flagged)  

### **Mentor Responsibilities**

Mentors must:
- Join sessions within 10 minutes of scheduled start time
- Ensure stable internet connection for WebSocket presence tracking
- Contact support if technical issues prevent joining

### **Mentee Protections**

Mentees are guaranteed:
- **Full refund** for mentor no-shows (100% of booking amount)
- **Automatic processing** (no support ticket required)
- **Immediate notification** of no-show status
- **On-chain transaction** (verifiable on Stellar blockchain)

---

## Testing

### **Manual Testing**

1. **Create a confirmed booking** with scheduled start time in the past
2. **Wait 10 minutes** (or set `NO_SHOW_GRACE_PERIOD_MINUTES=1` for faster testing)
3. **Verify no-show detection**:
   - Booking status updated to `no_show`
   - `no_show_detected_at` timestamp set
   - Refund transaction hash recorded
   - Notifications sent to both parties

### **Automated Testing**

```typescript
// Test no-show detection
it('should flag booking as no_show when mentor does not join', async () => {
  const booking = await createConfirmedBooking({
    scheduledAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
  });

  await processNoShowCheck({
    bookingId: booking.id,
    mentorId: booking.mentor_id,
    menteeId: booking.mentee_id,
    scheduledStart: booking.scheduled_at,
    gracePeriodMinutes: 10,
  });

  const updated = await BookingModel.findById(booking.id);
  expect(updated.status).toBe('no_show');
  expect(updated.no_show_detected_at).toBeTruthy();
  expect(updated.no_show_refund_tx_hash).toBeTruthy();
});

// Test no-show prevention when mentor joins
it('should NOT flag as no_show when mentor joins in time', async () => {
  const booking = await createConfirmedBooking({
    scheduledAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
  });

  await presenceService.markSessionJoined(
    booking.id,
    booking.mentor_id,
    'mentor'
  );

  await processNoShowCheck({
    bookingId: booking.id,
    mentorId: booking.mentor_id,
    menteeId: booking.mentee_id,
    scheduledStart: booking.scheduled_at,
    gracePeriodMinutes: 10,
  });

  const updated = await BookingModel.findById(booking.id);
  expect(updated.status).toBe('confirmed'); // Status unchanged
  expect(updated.no_show_detected_at).toBeNull();
});
```

---

## Support & Escalation

### **False Positives**

If a mentor believes they were incorrectly flagged:
1. **Evidence required**: WebSocket connection logs, meeting join timestamp
2. **Support review**: Manual verification of presence logs
3. **Resolution**: Manual status update + compensatory credit

### **Technical Issues**

If no-show detection fails:
- Check worker logs: `docker logs mentorsmind-worker`
- Verify Redis connectivity (presence tracking)
- Check BullMQ queue health: `await sessionNoShowQueue.getJobCounts()`

### **Dispute Process**

Mentees can dispute automatic refunds via:
- Standard dispute flow (if mentor claims technical issue)
- Evidence: mentor presence logs, join timestamps
- Soroban escrow supports dispute resolution

---

## Future Enhancements

### **Planned Features**

1. **Configurable grace periods per mentor tier**
   - Premium mentors: 15-minute grace period
   - Standard mentors: 10-minute grace period

2. **Partial refunds for late joins**
   - Mentor joins at 12 minutes: 20% refund to mentee

3. **Mentee no-show tracking**
   - Track `mentee_joined_at` for analytics
   - Apply penalties for habitual mentee no-shows

4. **Automated mentor warnings**
   - First no-show: warning email
   - Second no-show: temporary suspension
   - Third no-show: permanent account review

5. **Grace period extensions**
   - Allow mentors to request 5-minute extension via API
   - Must be requested before grace period expires

---

## Related Documentation

- **[Booking System Architecture](./BOOKING_SYSTEM.md)**
- **[Soroban Escrow Integration](./SOROBAN_ESCROW.md)**
- **[WebSocket Session Management](./WEBSOCKET_SESSIONS.md)**
- **[Notification System](./NOTIFICATIONS.md)**
- **[Worker Queue Architecture](./WORKERS.md)**

---

## Changelog

| Date       | Version | Changes                                      |
|------------|---------|----------------------------------------------|
| 2026-07-24 | 1.0.0   | Initial implementation of no-show detection  |

---

**Last Updated**: July 24, 2026  
**Maintained By**: Platform Engineering Team  
**Contact**: support@mentorsmind.com
