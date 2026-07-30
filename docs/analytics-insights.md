# Analytics Insights — Generation Methodology

Migration `108_add_analytics_insights_audience.sql` adds role-based targeting to `analytics_insights`:

| Column | Purpose |
|--------|---------|
| `target_audience` | `admin` \| `mentor` \| `learner` \| `all` |
| `user_id` | Personalized recipient (`NULL` = platform-wide) |
| `entity_id` | Mentor/learner the insight is about |

## Pipeline

1. **Scheduler** (`scheduler.ts`) enqueues `insight-generation-scheduled` every **6 hours** (`0 */6 * * *`).
2. **Worker** (`insight-generation.worker.ts`) runs `InsightGeneratorService.generateInsights()`.
3. Admin/platform insights are generated once and stored with `target_audience = 'admin'`, `user_id = NULL`.
4. One BullMQ job is enqueued per active user (`insight-generation-user`) and processed at concurrency **20** (SLA: ~1,000 users within 10 minutes).
5. On insert, `SocketService` emits `insight:new` to `user:{userId}` (or the `admin` room for platform insights).
6. Per user, only the **20 most recent unread** insights are kept; older unread rows are auto-marked read.

## Role-based signals

### Admin (platform-wide)
- Revenue trend from `mv_daily_revenue` (30d linear slope)
- Session completion anomalies from `mv_session_stats` (z-score > 2)
- User growth anomalies (weekly signup counts)
- Rule-based recommendations from `AdvancedAnalyticsService.getMetrics`

### Mentor (personal — `user_id = mentor`)
- Own session completion rate MoM
- Earnings trend (`bookings.mentor_payout`)
- Review rating trend (`reviews.reviewee_id`)
- Booking inquiry volume WoW

### Learner (personal — `user_id = mentee`, audience `learner`)
- Session attendance rate (30d)
- Goal progress velocity (`learner_goals` + `goal_progress_logs`)
- Personal spending trend (never platform revenue)
- Recommended next session hour from completed booking history

## Read path

`getInsights(userId)` joins `users` and returns:

- rows where `user_id = $1` (personal), **or**
- platform rows (`user_id IS NULL`) whose `target_audience` matches the caller’s role (`mentee` → `learner`)

Mentor A cannot see Mentor B’s personal insights. Learners are additionally filtered so revenue / admin metrics never appear.

## Consumers

- `AdvancedAnalyticsService.getInsights` → dashboard payload
- Socket.IO event `insight:new` (see `docs/websocket.md`)
