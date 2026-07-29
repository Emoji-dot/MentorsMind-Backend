# Recording Consent & Privacy Policy

> **Document status:** Active  
> **Last updated:** 2026-07-23  
> **Owner:** Platform Engineering  
> **Related migration:** `083_create_recording_consent.sql`

---

## Overview

MentorsMind records mentoring sessions only when **both** the mentor and the mentee have given explicit, informed consent. This document explains how consent is collected, stored, withdrawn, and audited, and what happens to recorded data afterwards.

---

## Legal Basis

Recording is a privacy-sensitive operation governed by:

| Regulation | Requirement |
|---|---|
| **GDPR (EU) Art. 6(1)(a)** | Processing personal data by consent — the data subject must freely, specifically, and unambiguously agree. |
| **GDPR Art. 7** | Conditions for consent — must be distinguishable, withdrawable at any time, and documented. |
| **CCPA / CPRA (California)** | Right to opt-out; businesses must disclose recording practices before the session begins. |
| **UK GDPR** | Same as EU GDPR post-Brexit. |
| **Local wiretapping laws** | Many jurisdictions require all-party consent for audio/video recording. The platform's two-party model satisfies the strictest requirements by design. |

The platform uses **consent (Art. 6(1)(a))** as the lawful basis. No recording may start without a verifiable consent record in the `recording_consent` table.

---

## Consent Flow

```
┌──────────────┐        POST /sessions/:id/recording/consent
│   Mentor     │───────────────────────────────────────────────▶ recording_consent (mentor row, consented=TRUE)
└──────────────┘

┌──────────────┐        POST /sessions/:id/recording/consent
│   Mentee     │───────────────────────────────────────────────▶ recording_consent (mentee row, consented=TRUE)
└──────────────┘

Both rows consented=TRUE?
        │
   YES  │  NO
        │   └─▶  POST /sessions/:id/recordings/start → 403 Forbidden
        │          { mentorConsented: false, menteeConsented: true }
        ▼
  Recording starts normally
```

### Step-by-step

1. **Before the session** — the platform UI prompts both participants to consent via `POST /sessions/:sessionId/recording/consent`. Each request is authenticated; the platform records the IP address and User-Agent for GDPR Art. 7(1) accountability.

2. **At recording start** — `POST /sessions/:sessionId/recordings/start` performs a consent gate check. If either participant has not consented (or has revoked consent), the request returns `403 Forbidden` with a machine-readable payload indicating which party has not yet consented.

3. **During the session** — either participant may call `DELETE /sessions/:sessionId/recording/consent` to withdraw consent. This:
   - Sets `consented = FALSE` and records `revoked_at` in `recording_consent`.
   - Immediately stops any active recording (`session_recordings.status → 'processing'`, `recording_ended_at` set to `NOW()`).
   - Records a `RECORDING_STOPPED_CONSENT_REVOKED` event in `audit_logs`.

4. **Re-granting consent** — calling `POST /sessions/:sessionId/recording/consent` again re-sets `consented = TRUE` and clears `revoked_at`. The session can then start a new recording.

---

## API Reference

### Grant Consent

```http
POST /api/v1/sessions/:sessionId/recording/consent
Authorization: Bearer <token>
```

**Response 200**
```json
{
  "success": true,
  "message": "Consent granted",
  "data": {
    "record": { "id": "...", "session_id": "...", "consented": true, "consented_at": "2026-07-23T10:00:00Z" },
    "sessionStatus": {
      "mentorConsented": true,
      "menteeConsented": false,
      "bothConsented": false
    }
  }
}
```

### Revoke Consent

```http
DELETE /api/v1/sessions/:sessionId/recording/consent
Authorization: Bearer <token>
```

**Response 200**
```json
{
  "success": true,
  "message": "Consent revoked",
  "data": {
    "record": { "id": "...", "consented": false, "revoked_at": "2026-07-23T10:30:00Z" },
    "recordingStopped": true,
    "stoppedRecordingId": "abc123"
  }
}
```

### Get Consent Status

```http
GET /api/v1/sessions/:sessionId/recording/consent
Authorization: Bearer <token>
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "sessionId": "...",
    "mentorConsented": true,
    "menteeConsented": true,
    "bothConsented": true,
    "records": [ ... ]
  }
}
```

---

## Data Stored

### `recording_consent` table (Migration 083)

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `session_id` | UUID | The session this consent belongs to |
| `user_id` | UUID | Who gave/revoked consent |
| `user_role` | `mentor` / `mentee` | Role in the session |
| `consented` | boolean | Current consent state |
| `consented_at` | timestamptz | When consent was last granted |
| `revoked_at` | timestamptz | When consent was last revoked |
| `consent_ip_address` | varchar | Client IP at action time |
| `consent_user_agent` | text | HTTP User-Agent at action time |

The `(session_id, user_id)` pair is unique — one row per participant per session.

### `audit_logs` events

Every consent and recording-access action writes an entry to `audit_logs`:

| Action | Trigger |
|---|---|
| `RECORDING_CONSENT_GRANTED` | User calls `POST /consent` |
| `RECORDING_CONSENT_REVOKED` | User calls `DELETE /consent` |
| `RECORDING_STARTED` | Recording begins successfully |
| `RECORDING_STOPPED_CONSENT_REVOKED` | Active recording halted by revocation |
| `RECORDING_ACCESSED` | Any read of a recording record |
| `RECORDING_PLAYBACK_URL_GENERATED` | Signed playback URL generated |
| `RECORDING_TRANSCRIPT_ACCESSED` | Transcription data fetched |
| `RECORDING_TRANSCRIPTION_STARTED` | Transcription job triggered |
| `RECORDING_DELETED` | Recording permanently removed |

---

## Access Controls

| Endpoint | Who can call it |
|---|---|
| `POST/DELETE/GET /sessions/:id/recording/consent` | Session participants (mentor or mentee) only |
| `POST /sessions/:id/recordings/start` | Session participants + both consented |
| `GET /recordings/:id` | Session participants or admin |
| `GET /recordings/:id/playback-url` | Session participants or admin |
| `GET/POST /recordings/:id/transcription` | Session participants or admin |
| `DELETE /recordings/:id` | Session participants or admin |
| `GET /recordings` | Any authenticated user (own recordings only) |

The `requireSessionParticipant` and `requireRecordingParticipant` middleware enforce these rules. Admin users (`role = 'admin'`) bypass participant checks to support support and compliance workflows.

Non-participants receive `HTTP 403 Forbidden` on all protected endpoints.

---

## Data Retention

Recordings are automatically purged `90 days` after creation (`expires_at` column, configurable via `recording.config.ts`). The `recordingCleanup.job.ts` cron job enforces this. Consent records in `recording_consent` follow the platform's standard data retention policy (2 years by default, configurable in `retention.config.ts`).

Users may request deletion of their data via the account deletion workflow (`DELETE /users/me`), which includes recording data via `accountDeletion.service.ts`.

---

## Incident Response

If a recording was started without valid consent (e.g. due to a bug bypassing the consent gate):

1. The recording must be **immediately deleted** from S3 and the `session_recordings` record marked `deleted`.
2. Both participants must be **notified** by email within 72 hours (GDPR Art. 33/34).
3. The incident must be logged under `audit_logs` with `action = 'RECORDING_UNAUTHORIZED_DELETION'`.
4. If the breach affects EU residents, notify the relevant Supervisory Authority within 72 hours of discovery.

---

## Changelog

| Date | Change |
|---|---|
| 2026-07-23 | Initial document — recording consent system implemented (issue #658) |
