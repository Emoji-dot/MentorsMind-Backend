-- Migration: Add database indexes for common queries to optimize performance

-- Table: transactions
-- Composite index for filtering a user's transactions by status and sorting by creation date
CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created 
ON transactions(user_id, status, created_at DESC);

-- Index for currency filtering/aggregation
CREATE INDEX IF NOT EXISTS idx_transactions_currency 
ON transactions(currency);

