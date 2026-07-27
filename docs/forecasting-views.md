# Forecasting Views

Migration `102_create_forecasting_views.sql` creates the materialized views used by `PredictiveEngineService`:

- `mv_revenue_time_series`
- `mv_hourly_session_demand`

Both views have unique indexes and can be refreshed concurrently:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_time_series;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_session_demand;
```

If these views are missing, forecasting methods return empty arrays and log a warning that points to migration `102_create_forecasting_views.sql`. Health checks report the missing views as degraded.

Migration `103_create_analytics_predictions.sql` creates `analytics_predictions`, which stores generated forecasts.

