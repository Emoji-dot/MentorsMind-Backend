-- Migration: 088_create_message_reads.sql
-- Description: Message read receipts for per-user tracking.

CREATE TABLE IF NOT EXISTS message_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint so a user can only have one read receipt per message
CREATE UNIQUE INDEX idx_message_reads_unique ON message_reads(message_id, user_id);
CREATE INDEX idx_message_reads_user_id ON message_reads(user_id);
