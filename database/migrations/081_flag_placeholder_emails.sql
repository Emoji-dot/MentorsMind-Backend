-- =============================================================================
-- Migration: 081_flag_placeholder_emails.sql
-- Description: Flag existing users with @placeholder.com emails for review in audit logs
-- =============================================================================

-- Insert audit logs for users with placeholder emails
INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    ip_address,
    user_agent,
    metadata
)
SELECT 
    id AS user_id,
    'PLACEHOLDER_EMAIL_DETECTED' AS action,
    'user' AS resource_type,
    id AS resource_id,
    NULL AS ip_address,
    NULL AS user_agent,
    jsonb_build_object('old_email', email) AS metadata
FROM users
WHERE email LIKE '%@placeholder.com'
  AND deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM audit_logs
      WHERE audit_logs.user_id = users.id
        AND audit_logs.action = 'PLACEHOLDER_EMAIL_DETECTED'
  );

-- Add comment
COMMENT ON TABLE audit_logs IS 'Stores audit trail of system events including placeholder email detections';
