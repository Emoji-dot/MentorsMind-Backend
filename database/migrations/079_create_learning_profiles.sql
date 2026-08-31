-- Migration: Create learning_profiles table for mentor matching v2
-- Issue #570: Mentor Matching Algorithm v2

CREATE TABLE IF NOT EXISTS learning_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  learning_style VARCHAR(20) NOT NULL CHECK (learning_style IN ('visual','auditory','kinesthetic','reading')),
  pace VARCHAR(10) NOT NULL CHECK (pace IN ('slow','moderate','fast')),
  preferred_session_length INTEGER NOT NULL DEFAULT 60,
  communication_style VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_profiles_user_id ON learning_profiles(user_id);
