-- Migration: persist chatbot messages for analytics and history
-- Issue #760.

CREATE TABLE IF NOT EXISTS chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  response TEXT NOT NULL,
  intent VARCHAR(100) NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT false,
  cleared_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_user_created
  ON chatbot_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_intent
  ON chatbot_messages(intent);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_escalated
  ON chatbot_messages(escalated);

