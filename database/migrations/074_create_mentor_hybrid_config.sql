-- Create mentor_hybrid_config table for Issue #422
CREATE TABLE IF NOT EXISTS mentor_hybrid_config (
    mentor_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    learning_paths_enabled BOOLEAN DEFAULT true,
    individual_sessions_enabled BOOLEAN DEFAULT true,
    auto_link_sessions BOOLEAN DEFAULT false,
    default_session_type VARCHAR(20) DEFAULT 'support' CHECK (default_session_type IN ('milestone', 'support', 'assessment')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mentor_hybrid_config_mentor ON mentor_hybrid_config(mentor_id);

-- Initialize hybrid mode for existing mentors
INSERT INTO mentor_hybrid_config (mentor_id, learning_paths_enabled, individual_sessions_enabled, auto_link_sessions)
SELECT id, true, true, false
FROM users 
WHERE role = 'mentor' 
ON CONFLICT (mentor_id) DO NOTHING;

