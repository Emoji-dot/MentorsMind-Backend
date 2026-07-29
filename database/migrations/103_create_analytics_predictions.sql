-- Migration: create analytics predictions storage
-- Issue #763: PredictiveEngineService.storePredictions inserts here.

CREATE TABLE IF NOT EXISTS analytics_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_type VARCHAR(100) NOT NULL,
  target_date DATE NOT NULL,
  predicted_value DECIMAL(20, 7) NOT NULL,
  confidence_interval_lower DECIMAL(20, 7),
  confidence_interval_upper DECIMAL(20, 7),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(prediction_type, target_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_predictions_type_date
  ON analytics_predictions(prediction_type, target_date);

