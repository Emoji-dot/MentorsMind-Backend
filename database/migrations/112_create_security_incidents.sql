-- Migration 112: Security incidents table for threat detection & automated
-- incident response (issue #840 "Advanced Threat Detection").
--
-- Populated by ThreatDetectionService (statistical/heuristic anomaly scoring
-- in ml-security.service.ts) and acted on by IncidentResponseService.

BEGIN;

CREATE TABLE IF NOT EXISTS security_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    incident_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    score NUMERIC,
    details JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'auto_resolved', 'escalated', 'dismissed')),
    response_action TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_incidents_user_created
    ON security_incidents (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_security_incidents_status
    ON security_incidents (status);

COMMIT;
