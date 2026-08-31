-- Migration: Create platform_health_snapshots table
-- Issue #567: Platform Health Score System

CREATE TABLE IF NOT EXISTS platform_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  overall_score INTEGER NOT NULL,
  components JSONB NOT NULL DEFAULT '{}',
  alerts JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_health_snapshots_created_at ON platform_health_snapshots(created_at);
