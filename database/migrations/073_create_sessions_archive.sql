-- Create sessions_archive table for data retention/archiving
CREATE TABLE IF NOT EXISTS sessions_archive (
    id UUID PRIMARY KEY,
    mentor_id UUID NOT NULL,
    mentee_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    status VARCHAR(20),
    meeting_link VARCHAR(500),
    meeting_url VARCHAR(500),
    meeting_provider VARCHAR(50),
    meeting_room_id VARCHAR(255),
    meeting_expires_at TIMESTAMP WITH TIME ZONE,
    needs_manual_intervention BOOLEAN,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index on archived_at for cleanup jobs
CREATE INDEX IF NOT EXISTS idx_sessions_archive_archived_at ON sessions_archive(archived_at);
CREATE INDEX IF NOT EXISTS idx_sessions_archive_mentor_id ON sessions_archive(mentor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_archive_mentee_id ON sessions_archive(mentee_id);
