-- =============================================================================
-- Migration: 091_add_export_format_and_approval.sql
-- Description: Add format, size tracking, and admin-approval fields to export_jobs.
--              Supports JSON / CSV / PDF export formats, size-based approval
--              workflow (warn >500 MB, require admin approval >1 GB), and
--              BullMQ job-id linkage for real-time progress polling.
-- =============================================================================

-- Export format: json | csv | pdf  (default json for backward-compat)
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS format VARCHAR(10) NOT NULL DEFAULT 'json';

-- Estimated size of the export before processing (bytes); used for approval gating
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS estimated_size_bytes BIGINT;

-- Actual size of the produced file (bytes)
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS actual_size_bytes BIGINT;

-- Admin-approval lifecycle
-- null          → not yet evaluated (small export, no approval needed)
-- 'pending'     → awaiting admin action (export >1 GB)
-- 'approved'    → admin approved; processing will proceed
-- 'rejected'    → admin rejected; processing is blocked
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20);

-- Which admin approved / rejected, and when
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- BullMQ job ID — lets the /progress endpoint query BullMQ for live percent
ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS bullmq_job_id VARCHAR(255);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_export_jobs_approval_status
    ON export_jobs(approval_status)
    WHERE approval_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_format
    ON export_jobs(format);

-- Comments
COMMENT ON COLUMN export_jobs.format IS 'Export format: json | csv | pdf';
COMMENT ON COLUMN export_jobs.estimated_size_bytes IS 'Pre-processing size estimate for approval gating';
COMMENT ON COLUMN export_jobs.actual_size_bytes IS 'Size of the produced archive/file in bytes';
COMMENT ON COLUMN export_jobs.approval_status IS 'null=not required, pending=awaiting admin, approved, rejected';
COMMENT ON COLUMN export_jobs.approved_by IS 'Admin user who approved or rejected the large export';
COMMENT ON COLUMN export_jobs.bullmq_job_id IS 'BullMQ job ID for live progress polling via /exports/:jobId/progress';
