# Session No-Show Detection - Deployment Checklist

## Pre-Deployment

### Code Review
- [ ] All files reviewed and approved
- [ ] TypeScript compilation successful
- [ ] No linting errors
- [ ] No security vulnerabilities (npm audit)
- [ ] Code changes documented

### Testing
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Manual testing completed
- [ ] Load testing completed (>100 concurrent sessions)
- [ ] Edge cases validated (race conditions, idempotency)

### Infrastructure
- [ ] Redis available and stable
- [ ] PostgreSQL database accessible
- [ ] Soroban escrow contract deployed and funded
- [ ] Environment variables configured
- [ ] Queue monitoring configured (BullMQ Board / UI)

---

## Deployment Steps

### 1. Database Migration

**Staging**
- [ ] Backup staging database
  ```bash
  pg_dump mentorminds_staging > backup_staging_$(date +%Y%m%d).sql
  ```
- [ ] Run migration on staging
  ```bash
  cd database && ./migrate.sh
  ```
- [ ] Verify migration
  ```sql
  \d bookings  -- Check for new columns
  \di bookings -- Check for new index
  ```
- [ ] Test migration rollback (optional)

**Production**
- [ ] Schedule maintenance window (low-traffic period)
- [ ] Backup production database
  ```bash
  pg_dump mentorminds_prod > backup_prod_$(date +%Y%m%d).sql
  ```
- [ ] Run migration on production
- [ ] Verify migration
- [ ] Monitor for errors (5 minutes)

### 2. Application Deployment

**Staging**
- [ ] Deploy code to staging
  ```bash
  git checkout staging
  git pull origin staging
  npm install
  npm run build
  npm restart
  ```
- [ ] Verify worker started
  ```bash
  grep "sessionNoShowWorker" logs/app.log
  ```
- [ ] Test API endpoints
  ```bash
  curl -X POST https://staging.mentorsmind.com/api/v1/bookings/{id}/join \
    -H "Authorization: Bearer {token}"
  ```
- [ ] Monitor logs for errors (1 hour)
- [ ] Verify no-show detection works (create test booking)

**Production**
- [ ] Deploy code to production
  ```bash
  git checkout main
  git pull origin main
  npm install
  npm run build
  ```
- [ ] Perform rolling restart (zero downtime)
  ```bash
  pm2 reload ecosystem.config.js --update-env
  ```
- [ ] Verify worker health
- [ ] Test API endpoints (sanity check)
- [ ] Monitor logs for errors (2 hours)

### 3. Configuration

- [ ] Set `NO_SHOW_GRACE_PERIOD_MINUTES` in production `.env`
  ```bash
  echo "NO_SHOW_GRACE_PERIOD_MINUTES=10" >> .env.production
  ```
- [ ] Verify Soroban escrow configuration
  ```bash
  grep "SOROBAN_ESCROW_CONTRACT_ADDRESS" .env.production
  ```
- [ ] Verify Redis connection
  ```bash
  redis-cli ping
  ```
- [ ] Verify BullMQ queues
  ```bash
  redis-cli KEYS "bull:session-no-show-queue:*"
  ```

---

## Post-Deployment

### Immediate (0-2 hours)

- [ ] Monitor error logs
  ```bash
  tail -f logs/error.log | grep "no-show"
  ```
- [ ] Check worker processing
  ```bash
  redis-cli GET "bull:session-no-show-queue:counts"
  ```
- [ ] Verify first no-show detection (if eligible booking exists)
- [ ] Check refund transactions on Stellar
  ```bash
  curl https://horizon.stellar.org/transactions/{tx_hash}
  ```

### First 24 Hours

- [ ] Monitor no-show rate
  ```sql
  SELECT COUNT(*) FROM bookings WHERE status = 'no_show' 
    AND no_show_detected_at > NOW() - INTERVAL '24 hours';
  ```
- [ ] Verify refund success rate (>99%)
  ```sql
  SELECT 
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE no_show_refund_tx_hash IS NOT NULL) AS successful
  FROM bookings WHERE status = 'no_show';
  ```
- [ ] Check for false positives (manual review)
- [ ] Monitor support tickets (no-show related)
- [ ] Verify notification delivery (check email/push logs)

### First Week

- [ ] Analyze no-show patterns
  ```sql
  SELECT DATE(no_show_detected_at), COUNT(*) 
  FROM bookings WHERE status = 'no_show'
  GROUP BY DATE(no_show_detected_at);
  ```
- [ ] Review mentor no-show rates (identify outliers)
  ```sql
  SELECT mentor_id, COUNT(*) AS no_shows
  FROM bookings WHERE status = 'no_show'
  GROUP BY mentor_id ORDER BY no_shows DESC LIMIT 10;
  ```
- [ ] Collect user feedback (mentors and mentees)
- [ ] Adjust grace period if needed (based on data)
- [ ] Document any issues or edge cases

---

## Monitoring Setup

### Alerts (Datadog / Sentry / PagerDuty)

- [ ] **No-show worker failures** (>3 in 1 hour)
  ```
  count(error{worker:session-no-show}) > 3
  ```
- [ ] **Refund failures** (>1 in 1 hour)
  ```
  count(log{message:*refund failed*}) > 1
  ```
- [ ] **Queue backlog** (>100 delayed jobs)
  ```
  bull.queue.delayed{queue:session-no-show} > 100
  ```
- [ ] **High no-show rate** (>5% per mentor over 30 days)
  ```
  (no_shows / total_sessions) * 100 > 5
  ```

### Dashboards

- [ ] Create Grafana dashboard with:
  - [ ] No-show rate trend (daily)
  - [ ] Refund success rate (daily)
  - [ ] Average grace period utilization
  - [ ] Worker processing time (p50, p95, p99)
  - [ ] Queue depth (waiting, delayed, active)

### Logs

- [ ] Configure log retention (30 days minimum)
- [ ] Set up log rotation (1GB max per file)
- [ ] Enable structured logging (JSON format)
- [ ] Forward logs to centralized system (ELK / Datadog)

---

## Rollback Plan

### Trigger Conditions

Rollback if:
- Critical bugs (false positives, refund failures)
- Worker crashes repeatedly (>5 times in 1 hour)
- Database performance degradation (>500ms query time)
- High support ticket volume (>10 complaints in 1 hour)

### Rollback Steps

1. **Stop Worker** (immediate)
   ```bash
   pm2 stop worker
   ```

2. **Disable Queue Processing** (prevents new jobs)
   ```bash
   redis-cli DEL bull:session-no-show-queue:*
   ```

3. **Revert Code** (if needed)
   ```bash
   git revert {commit-hash}
   npm run build
   npm restart
   ```

4. **Revert Database** (last resort)
   ```bash
   psql mentorminds_prod < migration_rollback.sql
   ```

5. **Notify Team**
   - Engineering team (Slack #platform-engineering)
   - Product team (Slack #product-team)
   - Support team (email + Slack #customer-support)

### Post-Rollback

- [ ] Document rollback reason
- [ ] Create incident report
- [ ] Schedule post-mortem meeting
- [ ] Identify root cause
- [ ] Implement fix and re-deploy

---

## Support Preparation

### Documentation

- [ ] Publish internal wiki page (session no-show policy)
- [ ] Update support knowledge base
- [ ] Create support ticket templates
- [ ] Document common issues and resolutions

### Team Training

- [ ] Train customer support on no-show policy
- [ ] Provide dispute resolution workflow
- [ ] Share admin tools for manual refunds
- [ ] Conduct Q&A session with engineering team

### Communication

- [ ] Announce feature to users (email campaign)
- [ ] Update Terms of Service (if needed)
- [ ] Publish blog post (platform reliability)
- [ ] Notify mentors via in-app banner

---

## Success Criteria

### Technical Metrics

- [ ] **Uptime**: Worker uptime >99.9%
- [ ] **Detection latency**: <1 minute after grace period
- [ ] **Refund latency**: <1 minute after detection
- [ ] **False positive rate**: <0.1%
- [ ] **Refund success rate**: >99%

### Business Metrics

- [ ] **User satisfaction**: NPS score maintained or improved
- [ ] **Support tickets**: <5% increase in volume
- [ ] **Mentor retention**: No significant drop
- [ ] **Mentee refund rate**: Reduced by >20%
- [ ] **Platform trust**: Positive user feedback

---

## Sign-Off

### Pre-Deployment

- [ ] **Engineering Lead**: ______________________ Date: __________
- [ ] **Product Manager**: ______________________ Date: __________
- [ ] **QA Lead**: ______________________ Date: __________

### Post-Deployment (24 hours)

- [ ] **Engineering Lead**: ______________________ Date: __________
- [ ] **DevOps Lead**: ______________________ Date: __________
- [ ] **Product Manager**: ______________________ Date: __________

### Post-Deployment (1 week)

- [ ] **Engineering Lead**: ______________________ Date: __________
- [ ] **Customer Support Lead**: ______________________ Date: __________
- [ ] **Product Manager**: ______________________ Date: __________

---

## Contact Information

**Engineering On-Call**: +1-XXX-XXX-XXXX  
**DevOps On-Call**: +1-XXX-XXX-XXXX  
**Product Manager**: product@mentorsmind.com  
**PagerDuty**: Session No-Show Alert

---

**Deployment Date**: ___________________  
**Deployment Lead**: ___________________  
**Version**: 1.0.0
