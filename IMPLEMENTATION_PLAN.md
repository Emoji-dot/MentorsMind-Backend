# Security & Features Overhaul - Implementation Plan

**Branch**: `feature/security-and-features-overhaul`
**Date Created**: July 29, 2026
**Status**: In Progress

---

## Overview

This epic addresses five critical areas:
1. **Admin MFA Enforcement & Step-Up Authentication** - Mandatory 2FA for admins with fresh TOTP verification for high-value operations
2. **Stellar Payment Monitoring Resilience** - Persist stream cursor, handle outages gracefully, recover missed payments
3. **Learning Path Prerequisite Validation** - DAG implementation with cycle detection and topological sorting
4. **Mentor Availability Management** - Enable mentors to declare working hours with timezone support
5. **Transcription Pipeline & AI Summary Integration** - Auto-submit recordings to AWS Transcribe, store transcripts, feed to AI summary engine

---

## Epic 1: Admin MFA Enforcement & Step-Up Authentication

### Problem
- Compromised admin JWT = full access to sensitive operations (escrow, disputes, user deletion) without second factor
- No current MFA requirement for admin accounts
- Admin operations affecting real XLM on Stellar lack additional verification

### Solution
- Mandatory MFA for all `role = 'admin'` users
- Step-up authentication: Fresh TOTP code for high-value operations
- Grace period: 5-minute window since last MFA verification
- Rate limiting: 5 failed attempts → 15-minute lockout
- JWT enhancement: `mfa_verified_at` claim for tracking verification time

### Technical Components

#### 1.1 Database Migration
**File**: `database/migrations/XXX_admin_mfa_enforcement.sql`
- Add `admin_mfa_lockout` table (Redis-backed, TTL-cached)
- Track failed step-up attempts per admin user
- Implement 15-minute lockout after 5 failures in 5 minutes

#### 1.2 New Middleware

**File**: `src/middleware/require-mfa.middleware.ts`
- Check admin user has `mfa_enabled = true`
- Return HTTP 403 if not enabled
- Suggest enabling MFA in response message

**File**: `src/middleware/step-up-auth.middleware.ts`
- Extract `X-MFA-Code` header
- Verify code is not older than 30 seconds
- Validate code via `mfa-otp.service.ts`
- Check grace period: skip if `mfa_verified_at` within last 5 minutes
- Track failed attempts in Redis
- Return HTTP 428 if code missing, HTTP 401 if invalid

#### 1.3 JWT Enhancements

**File**: `src/utils/jwt.utils.ts` (update)
- Add `mfa_verified_at` claim on successful step-up auth
- Update `AuthenticatedRequest` interface to include `mfa_verified_at`

#### 1.4 Admin Service Updates

**File**: `src/services/admin.service.ts` (update)
- Add gating logic for sensitive operations:
  - `resolveDispute()` - requires step-up
  - `releaseEscrow()` - requires step-up
  - `banUser()` - requires step-up
  - `suspendUser()` - requires step-up (long-term)
  - `deleteUser()` - requires step-up
- Return clear error messages directing to re-auth if MFA not recent

#### 1.5 Admin Routes Updates

**File**: `src/routes/admin.routes.ts` (update)
- Add `require-mfa` middleware to all admin routes (after authenticate)
- Add `step-up-auth` middleware to sensitive endpoints:
  - `POST /admin/disputes/:id/resolve`
  - `POST /admin/escrow/release`
  - `DELETE /admin/users/:id`
  - `PUT /admin/users/:id/suspend`
  - `PUT /admin/users/:id/ban`

#### 1.6 Redis Schema for Rate Limiting

**Key Pattern**: `admin:stepup:failures:{userId}`
- Value: JSON object with attempt count, first attempt timestamp
- TTL: 5 minutes (auto-expire)
- On 5th failure: set `admin:stepup:lockout:{userId}` with 15-minute TTL

#### 1.7 API Documentation

**File**: `docs/ADMIN_MFA.md`
- MFA enforcement policy
- Step-up authentication flow with examples
- Error codes and recovery
- Rate limiting behavior
- Grace period explanation

### Acceptance Criteria
- ✅ Admin without MFA enabled → HTTP 403 on all admin endpoints
- ✅ Step-up endpoint without `X-MFA-Code` → HTTP 428
- ✅ Invalid/reused TOTP code → HTTP 401
- ✅ 5 failed attempts in 5 minutes → HTTP 429 (locked out for 15 min)
- ✅ Grace period: MFA verified 3 minutes ago → step-up skipped
- ✅ Grace period: MFA verified 6 minutes ago → step-up required
- ✅ Successful step-up → JWT updated with `mfa_verified_at`

---

## Epic 2: Stellar Payment Monitoring Resilience

### Problem
- Stream opens with cursor "now" → misses all history on restart
- 30-second restart = 10–50 missed payment events
- No automatic reconnection on Horizon drop
- Bookings stuck in `payment_status = 'pending'` until manual retry

### Solution
- Persist last processed `paging_token` in Redis after each payment
- Resume from cursor instead of "now" on stream restart
- Automatic reconnection with exponential backoff (1s, 2s, 4s, max 60s)
- Bulk recovery of missed transactions within last 24 hours
- Prometheus metrics and health endpoint reporting

### Technical Components

#### 2.1 Utilities

**File**: `src/utils/stellar-cursor.utils.ts` (new)
- `persistCursor(account: string, pagingToken: string): Promise<void>`
- `loadCursor(account: string): Promise<string | null>`
- `clearCursor(account: string): Promise<void>`
- Redis key: `stellar:stream:cursor:{account}`
- TTL: 30 days

#### 2.2 Stellar Service Updates

**File**: `src/services/stellar.service.ts` (update)
- Add `getTransactionHistory(account, cursor, limit): Promise<Payment[]>`
- Handles cursor paging from Horizon (up to 200 per page)
- Used for backfill on reconnect

#### 2.3 Stellar Stream Service Complete Rewrite

**File**: `src/services/stellar-stream.service.ts` (rewrite)
- Replace `horizonStream.service.ts` or extend significantly
- Initialize stream with persisted cursor (or "now" if none)
- After each successful payment: persist cursor
- On stream error:
  - Detect outage duration (now vs last cursor time)
  - If outage > 24 hours: fetch `getTransactionHistory` up to 24h ago
  - If outage < 24 hours: fetch all missed txs
  - Process missed txs in order
  - Resume streaming from last cursor
- Implement exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
- Max 10 reconnect attempts before fallback to polling

#### 2.4 Fallback Polling Job

**File**: `src/jobs/stellar-polling.job.ts` (new)
- Activated only if stream reconnects fail 10 times
- Polls `getPaymentOperations()` every 30 seconds
- Same idempotency checks as stream processing
- Falls back to stream if it recovers

#### 2.5 Stellar Monitor Job Updates

**File**: `src/jobs/stellarMonitor.job.ts` (update)
- Initialize cursor loading on startup
- Log stream status (streaming | reconnecting | polling | stopped)
- Handle graceful shutdown: persist final cursor
- Emit health events for monitoring

#### 2.6 Prometheus Metrics

**File**: `src/metrics/stellar-metrics.ts` (new or integrate into existing)
- Counter: `stellar_events_processed_total`
- Counter: `stellar_events_missed_total`
- Gauge: `stellar_stream_status` (0=stopped, 1=streaming, 2=reconnecting, 3=polling)
- Gauge: `stellar_cursor_age_seconds` (time since last processed payment)
- Counter: `stellar_reconnect_attempts_total`
- Histogram: `stellar_reconnect_delay_seconds`

#### 2.7 Health Endpoint Enhancement

**File**: `src/controllers/health.controller.ts` (update)
- Add to GET `/health/detailed`:
```json
{
  "stellar_stream": {
    "status": "streaming|reconnecting|polling|stopped",
    "cursor_age_seconds": 45,
    "last_processed_at": "2026-07-29T12:34:56Z",
    "reconnect_attempts": 0,
    "events_processed_total": 1234,
    "events_missed_total": 5
  }
}
```

#### 2.8 Testing & Documentation

**File**: `tests/e2e/stellar-resilience.e2e.test.ts` (new)
- Test: Stream restart preserves cursor
- Test: Reconnect on simulated Horizon failure
- Test: Bulk recovery of missed txs
- Test: Idempotency (duplicate txs ignored)
- Test: Exponential backoff timing
- Test: Fallback to polling after max attempts
- Test: Cursor persists after graceful shutdown

**File**: `docs/STELLAR_RESILIENCE.md`
- Architecture diagram (stream → error → reconnect → backfill → resume)
- Recovery scenarios and timelines
- Cursor management and TTL
- Polling fallback trigger conditions
- Monitoring and alerting recommendations

### Acceptance Criteria
- ✅ After restart, stream resumes from last cursor (not "now")
- ✅ Payments in last 24h during outage are processed retroactively
- ✅ Stream reconnects automatically within 60s of disconnection
- ✅ 10+ failed reconnects trigger polling mode
- ✅ Polling resumes streaming if connection restored
- ✅ No duplicate transaction processing (idempotency)
- ✅ Health endpoint reports stream status accurately
- ✅ Prometheus metrics emit correctly

---

## Epic 3: Learning Path Prerequisite Validation

### Problem
- No cycle detection in prerequisite DAG
- Circular dependencies (A→B→C→A) cause infinite loops
- Request timeouts, high CPU usage
- Prerequisite tree resolution slow (no caching/optimization)

### Solution
- Implement directed acyclic graph (DAG) with adjacency list in PostgreSQL
- Kahn's algorithm for topological sorting
- Cycle detection on creation time (return HTTP 422 with cycle path)
- Prerequisite tree caching with invalidation on graph mutations
- Eligibility checking returns unmet prerequisites list

### Technical Components

#### 3.1 Database Migration

**File**: `database/migrations/XXX_learning_path_prerequisites_dag.sql`
- Add `learning_path_prerequisites` adjacency table (if not exists in schema):
```sql
CREATE TABLE learning_path_prerequisites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  from_milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  to_milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  is_required BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_path_id, from_milestone_id, to_milestone_id),
  CHECK (from_milestone_id != to_milestone_id)  -- Prevent self-loops
);
```
- Indexes: `(learning_path_id, from_milestone_id)`, `(to_milestone_id)`
- Add stored function `check_prerequisite_dag_cycle()` using recursive CTE

#### 3.2 DAG Utilities

**File**: `src/utils/dag.utils.ts` (new)
```typescript
export class DirectedAcyclicGraph {
  // Generic DAG implementation with cycle detection and topological sort
  
  constructor(nodes: string[], edges: Array<[string, string]>) {
    // Validate DAG on construction
  }
  
  detectCycle(): string[] | null {
    // Returns cycle path [A, B, C, A] or null if no cycle
    // Uses DFS with color marking (white, gray, black)
  }
  
  topologicalSort(): string[] {
    // Kahn's algorithm: returns valid ordering
    // O(V + E) complexity
  }
  
  getUnmetPrerequisites(nodeId: string, completedNodes: Set<string>): string[] {
    // Returns immediate prerequisites of nodeId not in completedNodes
  }
  
  transitiveDependencies(nodeId: string): Set<string> {
    // All nodes that must be completed before this one
  }
}
```

#### 3.3 Prerequisite Validator Service Rewrite

**File**: `src/services/prerequisite-validator.service.ts` (rewrite)
```typescript
export const PrerequisiteValidatorService = {
  
  async buildDAG(learningPathId: string): Promise<DirectedAcyclicGraph> {
    // Load all milestones and prerequisites for path
    // Construct adjacency list
    // Validate DAG on construction
  },

  async validatePrerequisiteCreation(
    learningPathId: string,
    fromMilestoneId: string,
    toMilestoneId: string
  ): Promise<{ valid: boolean; cycle?: string[] }> {
    // Test adding edge without persisting
    // Return cycle path if detected
  },

  async getPrerequisiteTree(
    learningPathId: string,
    userId: string
  ): Promise<PrerequisiteNode[]> {
    // Returns tree with completion status for user
    // Cached with key: `prerequisite:tree:{pathId}:{userId}`
    // TTL: 5 minutes
  },

  async isEligibleToEnroll(
    userId: string,
    learningPathId: string
  ): Promise<{ eligible: boolean; unmetPrerequisites: string[] }> {
    // Check all prerequisites for path root nodes
    // Return specific list of unmet prerequisite milestone IDs
  },

  async checkMilestoneEligibility(
    userId: string,
    milestoneId: string
  ): Promise<{ eligible: boolean; unmet: string[] }> {
    // Check prerequisites for single milestone
  }
};
```

#### 3.4 Learning Path Service Updates

**File**: `src/services/learning-path.service.ts` (update)
- `addPrerequisite()`: Call `validatePrerequisiteCreation()` before persist
  - Return HTTP 422 if cycle detected
  - Include cycle path in error response: `{ error: "Circular dependency detected", cycle: [A, B, C, A] }`
- `removePrerequisite()`: Invalidate cache
- Add `getPrerequisiteTree()` endpoint
- Add `isEligibleToEnroll()` check on enrollment creation

#### 3.5 Cache Invalidation

**File**: `src/utils/cache-key.utils.ts` (update)
- Cache key: `prerequisite:tree:{learningPathId}:{userId}`
- Invalidate on: add/remove prerequisite, completion status change
- Event-based: emit `prerequisite:graph:modified` event

#### 3.6 Learning Path Routes Updates

**File**: `src/routes/learning-path.routes.ts` (update)
- `POST /api/v1/learning-paths/:id/prerequisites`
  - Request: `{ fromMilestoneId, toMilestoneId, isRequired }`
  - Response: `{ success, cycle?, message }`
  - HTTP 422 if cycle detected
- `GET /api/v1/learning-paths/:id/prerequisite-tree?userId={userId}`
  - Response: Tree with completion status
  - Cache: 5 minutes
- `GET /api/v1/learning-paths/:id/enrollment-eligibility?userId={userId}`
  - Response: `{ eligible, unmetPrerequisites: [{ id, title, status }] }`
- `DELETE /api/v1/learning-paths/:id/prerequisites/:prerequisiteId`
  - Removes edge from DAG

#### 3.7 Complexity Analysis & Documentation

**File**: `docs/LEARNING_PATH_DAG.md`
- Architecture: Adjacency list → DFS/topological sort
- Cycle detection algorithm: DFS with color marking O(V+E)
- Topological sort: Kahn's algorithm O(V+E)
- Tree query complexity: O(V+E) worst case, cached after first call
- Enrollment check: O(immediate prerequisites) typically 3-5 nodes
- Performance targets: <200ms for 50-node DAG
- Examples: Simple path, multi-branch, large path

**File**: `tests/unit/prerequisite-validator.test.ts`
- Test cycle detection: A→B→A, A→B→C→A, complex transitive
- Test topological sort correctness
- Test ineligibility reasons
- Test cache invalidation
- Test large DAG performance (>50 nodes)

### Acceptance Criteria
- ✅ Circular prerequisite returns HTTP 422 with cycle path
- ✅ Topological sort returns correct enrollment order (>50 node DAG tested)
- ✅ Ineligible enrollment returns HTTP 403 with unmet prerequisites list
- ✅ Prerequisite tree query < 200ms for 50-node DAG
- ✅ Cycle detection handles: self-ref, 2-node cycles, transitive cycles
- ✅ Cache invalidates on graph mutation
- ✅ All edge cases covered with unit tests

---

## Epic 4: Mentor Availability Management

### Problem
- Mentors have no way to declare availability
- Entire booking system assumes 24/7 availability
- Mentors can't set working hours or timezone preferences
- Calendars show all time slots, no filtering by availability

### Solution
- Add `availability` field to User model (array of weekly slots)
- AvailabilityEditor component: visual 24-hour grid with 1-hour blocks
- Calendar component filters bookable slots by mentor availability
- Timezone-aware: display in learner's timezone, store in mentor's timezone
- Persist via `availability` JSONB column in users table

### Technical Components

#### 4.1 Database Migration (if needed)

**File**: `database/migrations/XXX_mentor_availability.sql`
- Add `availability` JSONB column to `users` table (if not exists)
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '[]'::jsonb;
CREATE INDEX idx_users_availability ON users USING GIN(availability) WHERE role = 'mentor';
```

#### 4.2 TypeScript Types

**File**: `src/types/availability.types.ts` (new)
```typescript
export interface AvailabilitySlot {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;  // Sunday = 0
  startHour: number;  // 0-23
  endHour: number;    // 1-24 (exclusive)
  timezone: string;   // IANA timezone string (e.g., 'UTC', 'America/New_York')
}

export interface AvailabilityEditor {
  slots: AvailabilitySlot[];
  updated_at: string;
}

export interface UserAvailability {
  id: string;
  email: string;
  availability: AvailabilitySlot[];
  timezone: string;  // User's default timezone
}
```

#### 4.3 Backend API

**File**: `src/services/availability.service.ts` (new or add to existing)
```typescript
export const AvailabilityService = {
  
  async updateMentorAvailability(
    mentorId: string,
    slots: AvailabilitySlot[]
  ): Promise<{ success: boolean }> {
    // Validate slots:
    // - dayOfWeek 0-6
    // - startHour < endHour
    // - timezone valid IANA string
    // Update users.availability JSONB
    // Invalidate cache
    return { success: true };
  },

  async getMentorAvailability(mentorId: string): Promise<AvailabilitySlot[]> {
    // Cached
    return slots;
  },

  async isAvailable(
    mentorId: string,
    timeSlot: { start: Date; end: Date }
  ): Promise<boolean> {
    // Check if timeSlot overlaps with mentor's availability
    // Handle timezone conversion
    return available;
  },

  async getAvailableSlots(
    mentorId: string,
    dateRange: { start: Date; end: Date },
    durationMinutes: number
  ): Promise<{ start: Date; end: Date }[]> {
    // Return array of available time slots in date range
    // Each slot is durationMinutes long
    // Filter by mentor availability AND booked sessions
    return slots;
  }
};
```

#### 4.4 Routes

**File**: `src/routes/mentors.routes.ts` (update) or new route
- `PUT /api/v1/mentors/:id/availability`
  - Request: `{ availability: AvailabilitySlot[] }`
  - Response: `{ success, slots: AvailabilitySlot[] }`
- `GET /api/v1/mentors/:id/availability`
  - Response: `{ id, email, availability, timezone }`
- `GET /api/v1/mentors/:id/available-slots?start=ISO&end=ISO&durationMinutes=60`
  - Response: `{ slots: [{ start, end }, ...] }`

#### 4.5 Booking Service Integration

**File**: `src/services/bookings.service.ts` (update)
- On booking creation: Check `AvailabilityService.isAvailable(mentorId, timeSlot)`
- Return HTTP 409 if not available with message: "Mentor is not available at this time"
- Include mentor's availability in booking response

#### 4.6 User Controller Updates

**File**: `src/controllers/users.controller.ts` (update)
- Merge availability into GET `/api/v1/users/:id/profile` response
- Include in PUT `/api/v1/users/:id/profile` for updates

#### 4.7 Calendar Component Integration

**File**: NOTE - Frontend component (referenced for backend API contract)
```typescript
// Frontend will consume:
// - GET /api/v1/mentors/:id/available-slots?start=ISO&end=ISO&durationMinutes=60
// - Returns array of { start, end } time objects
// - Calendar greys out unavailable slots
```

#### 4.8 Timezone Utilities

**File**: `src/utils/timezone.utils.ts` (enhance if exists)
```typescript
export function convertToUserTimezone(
  date: Date,
  fromTimezone: string,
  toTimezone: string
): Date {
  // Convert date from fromTimezone to toTimezone
}

export function isValidTimezone(tz: string): boolean {
  // Validate IANA timezone string
}

export function getUserTimezoneSlots(
  slots: AvailabilitySlot[],
  userTimezone: string
): AvailabilitySlot[] {
  // Convert slots from mentor timezone to user timezone
  // Handle day-boundary crossings
}
```

#### 4.9 API Documentation & Examples

**File**: `docs/MENTOR_AVAILABILITY.md`
- Example: Set weekly availability (Mon-Fri 9-17 UTC)
- Example: Query available slots for booking
- Example: Timezone conversion scenarios
- Error cases: Invalid timezone, overlapping bookings, no availability set
- Frontend integration guide

**File**: `tests/unit/availability.service.test.ts`
- Test availability updates
- Test isAvailable() with various timezones
- Test slot generation across days
- Test timezone conversion edge cases (day boundaries, DST)
- Test conflict with existing bookings

### Frontend Components (Architectural contract - implemented in frontend repo)

#### 4.10 AvailabilityEditor Component

```typescript
// Usage in MentorDashboard or EditProfileModal
<AvailabilityEditor
  mentorId={userId}
  defaultSlots={currentAvailability}
  onSave={async (slots) => {
    const response = await api.put(`/mentors/${userId}/availability`, { availability: slots });
    return response.success;
  }}
/>

// Features:
// - 7x24 grid (days × hours)
// - Toggle 1-hour blocks
// - Timezone selector
// - Save/Cancel buttons
// - Visual feedback (green = available, gray = unavailable)
```

#### 4.11 Calendar Component Enhancement

```typescript
// Existing Calendar.tsx integration
const { mentorId, selectedDate } = props;
const availableSlots = await api.get(
  `/mentors/${mentorId}/available-slots`,
  { start: dateRangeStart, end: dateRangeEnd, durationMinutes: 60 }
);

// Grey out unavailable slots in calendar
slots.forEach(slot => {
  if (!availableSlots.includes(slot)) {
    markAsUnavailable(slot);
  }
});
```

#### 4.12 "Contact to Schedule" Message

```typescript
// If mentor has no availability set
{
  mentorAvailability.length === 0 ? (
    <div className="no-availability-notice">
      This mentor hasn't set their availability yet.
      <button>Contact to schedule</button>
    </div>
  ) : (
    <Calendar mentor={mentor} />
  )
}
```

### Acceptance Criteria
- ✅ Mentor can set weekly recurring availability via API
- ✅ Availability persists and returns on subsequent queries
- ✅ Booking calendar shows only available slots
- ✅ Timezone conversion correct (Nigeria UTC+1 ↔ EST UTC-5 tested)
- ✅ Mentors without availability show "Contact to schedule" message
- ✅ Booking to unavailable slot rejected with HTTP 409
- ✅ Available slots endpoint < 200ms for 7-day range

---

## Epic 5: Transcription Pipeline & AI Summary Integration

### Problem
- Transcription pipeline non-functional: no end-to-end flow
- S3 recordings not submitted to AWS Transcribe
- Webhooks for transcription completion not handled
- Transcripts not stored in `recording_transcriptions` table
- AI summaries fall back to notes only, drastically reducing quality

### Solution
- Auto-submit S3 recordings to AWS Transcribe after upload
- Poll for completion with exponential backoff (max 30 min)
- Store transcripts with metadata (word count, confidence, S3 key)
- Index in Elasticsearch for search
- Feed transcripts to AI summary service
- Expose transcript endpoint for session participants

### Technical Components

#### 5.1 Database Schema

**File**: `database/migrations/XXX_transcription_pipeline.sql`
- Ensure `recording_transcriptions` table has:
```sql
CREATE TABLE recording_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recording_id UUID REFERENCES session_recordings(id) ON DELETE SET NULL,
  transcript_text TEXT NOT NULL,
  transcript_json JSONB,  -- Full AWS Transcribe output
  word_count INTEGER,
  confidence NUMERIC(3, 2),  -- Average confidence (0.0-1.0)
  s3_key VARCHAR(500),  -- S3 path to original JSON
  transcription_job_id VARCHAR(255),  -- AWS Transcribe JobName
  transcription_status VARCHAR(50),  -- QUEUED, IN_PROGRESS, COMPLETED, FAILED
  transcription_error TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  language_code VARCHAR(10) DEFAULT 'en-US',
  indexed_at TIMESTAMP WITH TIME ZONE,  -- When indexed in ES
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```
- Indexes: `(booking_id)`, `(transcription_job_id)`, `(transcription_status, created_at DESC)`
- Trigger to update session_recordings.transcription_status on insert

#### 5.2 AWS Transcribe Service

**File**: `src/services/transcribe.service.ts` (new)
```typescript
export const TranscribeService = {
  
  async startTranscriptionJob(
    s3Key: string,
    bookingId: string,
    mediaFormat: 'mp4' | 'wav' | 'mp3' = 'mp4'
  ): Promise<{ jobName: string; jobId: string }> {
    // Submit recording to AWS Transcribe
    // jobName format: `mentorsmind-{bookingId}-{timestamp}`
    // Set output S3 bucket
    // Return jobName for polling
  },

  async pollTranscriptionStatus(
    jobName: string
  ): Promise<{ status: string; transcript?: string; error?: string }> {
    // Poll GetTranscriptionJob until COMPLETED or FAILED
    // Exponential backoff: 2s, 4s, 8s, max 30 minutes
    // Return status, transcript JSON, or error
  },

  async getTranscriptionOutput(jobName: string): Promise<{
    transcriptText: string;
    wordCount: number;
    averageConfidence: number;
    items: any[];  // Word-level confidence data
  }> {
    // Download JSON from S3 (set by AWS Transcribe)
    // Parse transcript text
    // Calculate word count and average confidence
  },

  async handleTranscriptionFailure(
    jobName: string,
    attemptNumber: number
  ): Promise<void> {
    // Get original S3 key from Redis cache
    // Retry with different media format
    // Max 3 attempts total
  }
};
```

#### 5.3 Transcription Worker Rewrite

**File**: `src/workers/transcription.worker.ts` (rewrite)
```typescript
// BullMQ worker for TRANSCRIPTION queue
// Job structure:
// {
//   bookingId: UUID,
//   recordingId: UUID,
//   s3Key: string,
//   attemptNumber: number (1-3)
// }

export async function handleTranscriptionJob(job: Job) {
  const { bookingId, recordingId, s3Key, attemptNumber = 1 } = job.data;
  
  // 1. Start AWS Transcribe job
  const { jobName } = await TranscribeService.startTranscriptionJob(s3Key);
  
  // 2. Store job reference in Redis for polling
  // 3. Schedule polling job
  
  // 4. Poll for completion (exponential backoff, max 30 min)
  const result = await TranscribeService.pollTranscriptionStatus(jobName);
  
  // 5. On completion:
  if (result.status === 'COMPLETED') {
    // - Download transcript from S3
    const transcript = await TranscribeService.getTranscriptionOutput(jobName);
    
    // - Store in recording_transcriptions
    await RecordingTranscriptionsModel.create({
      booking_id: bookingId,
      recording_id: recordingId,
      transcript_text: transcript.transcriptText,
      transcript_json: result.fullJson,
      word_count: transcript.wordCount,
      confidence: transcript.averageConfidence,
      s3_key: s3Key,
      transcription_job_id: jobName,
      transcription_status: 'COMPLETED',
      completed_at: new Date(),
    });
    
    // - Index in Elasticsearch
    await ElasticsearchService.indexTranscript({
      bookingId,
      transcriptText: transcript.transcriptText,
    });
    
    // - Trigger AI summary generation
    await SessionSummaryModel.generateAndStore(bookingId, {
      transcriptText: transcript.transcriptText,
    });
    
    // - Emit WebSocket event
    SocketService.emitToSession(bookingId, 'transcript:available', {
      transcriptId: transcriptId,
      wordCount: transcript.wordCount,
    });
  } else if (result.status === 'FAILED') {
    // On failure: retry up to 3 times with different format
    if (attemptNumber < 3) {
      await enqueueTranscriptionJob({
        ...job.data,
        attemptNumber: attemptNumber + 1,
      });
    } else {
      // Max retries exceeded
      await RecordingTranscriptionsModel.updateStatus(
        bookingId,
        'FAILED',
        result.error
      );
    }
  }
}
```

#### 5.4 Transcription Queue Setup

**File**: `src/queues/transcription.queue.ts` (update or create)
```typescript
export async function enqueueTranscriptionJob(
  bookingId: string,
  recordingId: string,
  s3Key: string
): Promise<void> {
  await transcriptionQueue.add(
    'transcribe',
    {
      bookingId,
      recordingId,
      s3Key,
      attemptNumber: 1,
    },
    {
      attempts: 1,  // No automatic retry (manual retry with format change)
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,  // Keep failed jobs for investigation
    }
  );
}
```

#### 5.5 Session Recording Service Integration

**File**: `src/services/session-recording.service.ts` (update)
- On S3 upload complete (after virus scan):
```typescript
// Call enqueueTranscriptionJob after upload success
await enqueueTranscriptionJob(bookingId, recordingId, s3Key);
```

#### 5.6 Elasticsearch Integration

**File**: `src/services/elasticsearch-index.service.ts` (update)
- Add `indexTranscript()` method:
```typescript
async indexTranscript(data: {
  bookingId: string;
  transcriptText: string;
  bookingDate: Date;
  mentorId: string;
  studentId: string;
}): Promise<void> {
  // Index in Elasticsearch with type=transcript
  // Searchable via messageSearch.service.ts
  // TTL: 7 years (retention period)
}
```

#### 5.7 Session Summary Service Integration

**File**: `src/services/session-summary.service.ts` or `src/services/ai-summary.service.ts` (update)
- Update `generateAndStore()` to accept transcript:
```typescript
async generateAndStore(
  bookingId: string,
  context: { transcriptText?: string; notes?: string }
): Promise<SessionSummary> {
  // Primary input: transcriptText
  // Fallback input: notes
  // Use OpenAI API to generate summary
  // Store in session_summaries table
}
```

#### 5.8 Transcript Endpoint

**File**: `src/routes/sessions.routes.ts` (update)
- Add new endpoint:
```typescript
GET /api/v1/sessions/:id/transcript

// Query params:
// - format: 'text' | 'json' (default: 'text')
// - include_metadata: boolean (default: false)

// Authorization:
// - Session participants only (mentor, student)
// - Admin users

// Response:
{
  success: true,
  data: {
    transcriptText: string,
    wordCount: number,
    confidence: number,
    completedAt: string,
    format: 'text'
  }
}

// Error cases:
// - 404: No transcript for session
// - 403: Not a session participant
// - 202: Transcription in progress
```

**File**: `src/controllers/session-transcription.controller.ts` (update or create)
```typescript
export const SessionTranscriptionController = {
  async getTranscript(req, res) {
    const { sessionId } = req.params;
    const { format = 'text' } = req.query;
    
    // Verify user is session participant or admin
    const session = await BookingsModel.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    const isParticipant = 
      req.user.id === session.mentor_id || 
      req.user.id === session.student_id ||
      req.user.role === 'admin';
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get transcript
    const transcript = await RecordingTranscriptionsModel.findByBookingId(sessionId);
    if (!transcript) return res.status(404).json({ error: 'No transcript available' });
    
    if (transcript.transcription_status === 'IN_PROGRESS') {
      return res.status(202).json({ message: 'Transcription in progress' });
    }
    
    if (transcript.transcription_status === 'FAILED') {
      return res.status(503).json({ error: 'Transcription failed' });
    }
    
    // Return requested format
    const data = format === 'json' 
      ? transcript.transcript_json 
      : { transcriptText: transcript.transcript_text };
    
    res.json({ success: true, data });
  }
};
```

#### 5.9 Error Handling & Retries

**File**: `src/services/transcribe.service.ts` (add retry logic)
- Retry triggers:
  - UnsupportedMediaFormat → convert to WAV and retry
  - ServiceUnavailable → exponential backoff
  - MaxAttemptsExceeded → fail and alert admin
- Store attempt metadata in Redis for debugging

#### 5.10 Monitoring & Metrics

**File**: `src/metrics/transcription-metrics.ts` (new)
```typescript
// Prometheus metrics
Counter: transcription_jobs_total (labels: status, format)
Counter: transcription_retries_total (labels: reason)
Histogram: transcription_duration_seconds
Gauge: transcription_queue_depth
Counter: transcription_errors_total (labels: error_type)
```

#### 5.11 Health Endpoint Enhancement

**File**: `src/controllers/health.controller.ts` (update)
- Add to GET `/health/detailed`:
```json
{
  "transcription_service": {
    "status": "healthy|degraded|offline",
    "queue_depth": 12,
    "recent_errors": [],
    "aws_transcribe_available": true
  }
}
```

#### 5.12 Environment Configuration

**File**: `.env.example` (update)
```
# AWS Transcribe
AWS_TRANSCRIBE_REGION=us-east-1
AWS_TRANSCRIBE_OUTPUT_S3_BUCKET=mentorsmind-transcripts
AWS_TRANSCRIBE_ROLE_ARN=arn:aws:iam::ACCOUNT:role/TranscribeRole
AWS_TRANSCRIBE_LANGUAGE_CODE=en-US
AWS_TRANSCRIBE_TIMEOUT_MINUTES=30
AWS_TRANSCRIBE_MAX_RETRIES=3

# Elasticsearch Transcripts
ELASTICSEARCH_TRANSCRIPT_INDEX=transcripts
ELASTICSEARCH_TRANSCRIPT_TTL_DAYS=2555  # ~7 years
```

#### 5.13 Testing & Documentation

**File**: `tests/unit/transcribe.service.test.ts` (new)
- Mock AWS Transcribe SDK
- Test job submission, polling, output parsing
- Test error handling and retries
- Test confidence calculation

**File**: `tests/e2e/transcription-pipeline.e2e.test.ts` (new)
- Full flow: recording upload → transcription job → completion → summary
- Verify storage in recording_transcriptions
- Verify Elasticsearch indexing
- Verify transcript endpoint access control

**File**: `docs/TRANSCRIPTION_PIPELINE.md` (new)
- Architecture diagram: S3 → AWS Transcribe → Polling → Storage → Summary
- Cost estimates (AWS Transcribe pricing per minute)
- Recovery procedures (job failure, orphaned jobs)
- Tuning parameters (polling interval, timeout)

### Acceptance Criteria
- ✅ Recording upload → TranscriptionJob queued automatically
- ✅ AWS Transcribe job started with S3 output configured
- ✅ Polling with exponential backoff (2s, 4s, 8s, max 30 min)
- ✅ Transcript stored in recording_transcriptions with metadata
- ✅ Word count & average confidence calculated correctly
- ✅ Transcript indexed in Elasticsearch
- ✅ AI summary triggered on completion
- ✅ GET `/api/v1/sessions/:id/transcript` restricted to participants
- ✅ Failed jobs retry up to 3 times with format change
- ✅ Health endpoint reports transcription service status

### Deliverables
- 1 new service (transcribe.service.ts)
- 2 worker/queue files (transcription.worker.ts, transcription.queue.ts)
- 1 controller update (session-transcription.controller.ts)
- 3 service updates (session-recording.service.ts, elasticsearch, ai-summary)
- 1 route update (sessions.routes.ts)
- 1 migration (recording_transcriptions schema)
- 2 e2e + unit tests
- 1 comprehensive documentation file
- Prometheus metrics

---

## Implementation Order

### Phase 1: Foundation (Week 1-2)
1. **Epic 1.1-1.2**: Create MFA middleware + database schema
2. **Epic 2.1-2.2**: Create cursor utilities and stellar service updates
3. **Epic 3.1-3.2**: Create DAG utilities and prerequisite validator rewrite
4. **Epic 4.1-4.2**: Create availability types and database schema
5. **Epic 5.1**: Create recording_transcriptions schema + AWS SDK setup

### Phase 2: Core Logic (Week 3-4)
1. **Epic 1.3-1.5**: JWT updates, admin service, admin routes
2. **Epic 2.3-2.5**: Stellar stream service rewrite, polling job, monitor job
3. **Epic 3.3-3.4**: Prerequisite validator endpoints, learning path service
4. **Epic 4.3-4.5**: Availability service, routes, booking integration
5. **Epic 5.2-5.8**: Transcribe service, worker rewrite, queue, elasticsearch, summary integration

### Phase 3: Testing & Monitoring (Week 5)
1. **Epic 1.7**: MFA documentation, test middleware behavior
2. **Epic 2.6-2.8**: Prometheus metrics, health endpoint, e2e tests
3. **Epic 3.5-3.7**: Cache invalidation, complexity docs, unit tests
4. **Epic 4.9**: API docs, availability tests, timezone edge cases
5. **Epic 5.10-5.13**: Transcription metrics, health endpoint, tests, documentation

### Phase 4: Integration & Frontend (Week 6)
1. **Epic 1**: Security audit, rate limiting verification
2. **Epic 2**: Chaos testing (kill Redis, verify recovery)
3. **Epic 3**: Learning path integration tests
4. **Epic 4**: Frontend component development (separate repo)
5. **Epic 5**: End-to-end transcription flow testing, production readiness

---

## Risk Mitigation

### High-Risk Areas
1. **Admin MFA**: Lockout risk if implementation wrong → Test thoroughly with backup codes
2. **Stellar stream**: Cursor loss risk → Persist to Redis immediately, with replication
3. **DAG cycle detection**: Performance risk on large graphs → Cache aggressively, profile with 100+ nodes
4. **Availability timezone**: Off-by-one errors → Comprehensive UTC offset testing

### Rollout Strategy
1. **Admin MFA**: Feature flag (default off), enable for sandbox first
2. **Stellar monitoring**: Run alongside old stream for 1 week, compare event counts
3. **Learning paths**: Non-breaking; cycle check only on creation, not retrieval
4. **Mentor availability**: Optional; UI hides if not set, calendars default to 24/7

---

## Success Metrics

- **Admin MFA**: 100% of admins using MFA within 30 days, 0 unauthorized admin actions
- **Stellar monitoring**: 0 missed payment events in 30 days, <5 second median reconnect time
- **Learning paths**: 0 cycles in production, prerequisite queries < 150ms p95
- **Mentor availability**: 80% of mentors set availability, 90% booking accuracy increase

---

## Team Assignments (Example)

| Epic | Owner | Reviewer | Status |
|------|-------|----------|--------|
| Admin MFA | Backend Engineer A | Security Lead | TODO |
| Stellar Monitoring | Backend Engineer B | DevOps Lead | TODO |
| Learning Paths | Backend Engineer C | Architect | TODO |
| Mentor Availability | Backend Engineer D + Frontend | Product PM | TODO |
| Transcription Pipeline | Backend Engineer E | QA Lead | TODO |

---

## Related Issues

- GitHub Issue: "Admin accounts need MFA enforcement"
- GitHub Issue: "Payment events lost on server restart"
- GitHub Issue: "Circular learning path dependencies cause crashes"
- GitHub Issue: "Add mentor availability scheduling"
- GitHub Issue: "Transcription pipeline non-functional, AI summaries low quality"

---

## Appendix: File Manifest

### New Files
```
src/middleware/require-mfa.middleware.ts
src/middleware/step-up-auth.middleware.ts
src/utils/stellar-cursor.utils.ts
src/utils/dag.utils.ts
src/types/availability.types.ts
src/services/availability.service.ts
src/services/transcribe.service.ts
src/jobs/stellar-polling.job.ts
src/metrics/stellar-metrics.ts
src/metrics/transcription-metrics.ts
src/controllers/session-transcription.controller.ts
database/migrations/XXX_admin_mfa_enforcement.sql
database/migrations/XXX_learning_path_prerequisites_dag.sql
database/migrations/XXX_mentor_availability.sql
database/migrations/XXX_transcription_pipeline.sql
docs/ADMIN_MFA.md
docs/STELLAR_RESILIENCE.md
docs/LEARNING_PATH_DAG.md
docs/MENTOR_AVAILABILITY.md
docs/TRANSCRIPTION_PIPELINE.md
tests/e2e/stellar-resilience.e2e.test.ts
tests/e2e/transcription-pipeline.e2e.test.ts
tests/unit/prerequisite-validator.test.ts
tests/unit/availability.service.test.ts
tests/unit/transcribe.service.test.ts
```

### Updated Files
```
src/utils/jwt.utils.ts
src/utils/timezone.utils.ts
src/utils/cache-key.utils.ts
src/services/admin.service.ts
src/services/learning-path.service.ts
src/services/prerequisite-validator.service.ts
src/services/stellar.service.ts
src/services/stellar-stream.service.ts
src/services/bookings.service.ts
src/services/session-recording.service.ts
src/services/elasticsearch-index.service.ts
src/services/session-summary.service.ts (or ai-summary.service.ts)
src/controllers/health.controller.ts
src/controllers/users.controller.ts
src/routes/admin.routes.ts
src/routes/learning-path.routes.ts
src/routes/mentors.routes.ts
src/routes/sessions.routes.ts
src/workers/transcription.worker.ts
src/queues/transcription.queue.ts
src/types/api.types.ts (AuthenticatedRequest update)
.env.example
```

---

**Last Updated**: July 29, 2026
**Next Review**: August 5, 2026
