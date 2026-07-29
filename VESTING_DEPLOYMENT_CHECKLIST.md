# Vesting System - Deployment Checklist

Use this checklist to ensure proper deployment of the vesting contract integration.

## ✅ Pre-Deployment Checklist

### 1. Smart Contract Deployment
- [ ] Contract compiled successfully
- [ ] Contract deployed to testnet
- [ ] Contract deployed to mainnet (if production)
- [ ] Contract address recorded: `_________________________`
- [ ] Contract initialized with admin and token addresses
- [ ] Test transactions confirmed on-chain

### 2. Environment Configuration
- [ ] `SOROBAN_VESTING_CONTRACT_ADDRESS` set in `.env`
- [ ] `SOROBAN_RPC_URL` configured
- [ ] `PLATFORM_SECRET_KEY` configured (admin signing key)
- [ ] `PLATFORM_PUBLIC_KEY` configured (derived or explicit)
- [ ] `STELLAR_NETWORK` set correctly (testnet/mainnet)
- [ ] Redis connection configured (for worker queues)
- [ ] Database connection configured

### 3. Database Setup
- [ ] PostgreSQL database accessible
- [ ] Migration `089_create_vesting_schedules.sql` exists
- [ ] Migration ran successfully: `npm run migrate:up`
- [ ] Tables created: `vesting_schedules`, `vesting_claims`, `vesting_sync_log`
- [ ] Indexes created successfully
- [ ] Triggers created successfully
- [ ] Database permissions granted for application user

### 4. Code Verification
- [ ] All new files present (14 files created)
- [ ] All modified files updated (6 files modified)
- [ ] TypeScript compilation successful: `npm run build:check`
- [ ] No TypeScript errors
- [ ] No linting errors: `npm run lint`

### 5. Dependencies
- [ ] `@stellar/stellar-sdk` version 14.5.0+ installed
- [ ] `bullmq` version 5.71.0+ installed
- [ ] All dependencies installed: `npm install`
- [ ] No dependency conflicts

## 🧪 Testing Checklist

### 6. Unit Tests (if implemented)
- [ ] Service tests passing
- [ ] Controller tests passing
- [ ] Utility function tests passing
- [ ] All tests: `npm run test`

### 7. API Testing
- [ ] Admin endpoints accessible
- [ ] Authentication working
- [ ] Authorization working (admin vs user)
- [ ] Create schedule successful
- [ ] List schedules successful
- [ ] Get schedule by ID successful
- [ ] Revoke schedule successful
- [ ] My schedules endpoint working
- [ ] Claim endpoint working
- [ ] Claim history working
- [ ] Public query endpoint working

### 8. Validation Testing
- [ ] Cliff < 3600s rejected (HTTP 422)
- [ ] Vesting < 86400s rejected (HTTP 422)
- [ ] Vesting > 315360000s rejected (HTTP 422)
- [ ] Cliff > vesting rejected (HTTP 422)
- [ ] Invalid beneficiary address rejected
- [ ] Negative amounts rejected
- [ ] Missing required fields rejected

### 9. Authorization Testing
- [ ] Non-admin cannot create schedules
- [ ] Non-admin cannot revoke schedules
- [ ] User cannot claim others' schedules
- [ ] Unauthenticated requests rejected
- [ ] Public endpoints work without auth

### 10. Worker Testing
- [ ] Worker process starts successfully
- [ ] Vesting sync worker registered
- [ ] Scheduler shows vesting sync job
- [ ] Sync job runs on schedule (wait 6 hours or trigger manually)
- [ ] Sync logs written to `vesting_sync_log`
- [ ] Failed syncs handled gracefully
- [ ] Worker restart doesn't create duplicate jobs

## 🚀 Deployment Steps

### 11. API Server Deployment
- [ ] Environment variables set in production
- [ ] API server deployed
- [ ] Health check passing: `GET /health`
- [ ] Routes registered: Check `GET /` for endpoints list
- [ ] No startup errors in logs
- [ ] SSL/TLS configured
- [ ] Rate limiting active

### 12. Worker Process Deployment
- [ ] Worker deployed as separate service/process
- [ ] Worker logs showing "All workers started"
- [ ] Vesting sync worker in worker list
- [ ] Scheduler showing vesting sync registered
- [ ] Redis connection successful
- [ ] No startup errors in logs

### 13. Database Verification
- [ ] All tables present:
  ```sql
  SELECT table_name FROM information_schema.tables 
  WHERE table_name IN ('vesting_schedules', 'vesting_claims', 'vesting_sync_log');
  ```
- [ ] All indexes present:
  ```sql
  SELECT indexname FROM pg_indexes 
  WHERE tablename = 'vesting_schedules';
  ```
- [ ] Triggers present:
  ```sql
  SELECT trigger_name FROM information_schema.triggers 
  WHERE event_object_table = 'vesting_schedules';
  ```

### 14. Monitoring Setup
- [ ] Logging configured and working
- [ ] Error tracking configured (Sentry/DataDog)
- [ ] Metrics collection enabled
- [ ] Dashboard created for vesting metrics
- [ ] Alerts configured:
  - [ ] Sync failures > 5% (24h)
  - [ ] No sync in 12 hours
  - [ ] High error rate on endpoints
  - [ ] Claim failures

### 15. Documentation Deployment
- [ ] `docs/VESTING.md` accessible to team
- [ ] `VESTING_INTEGRATION.md` shared with developers
- [ ] `VESTING_QUICK_REFERENCE.md` shared with operators
- [ ] API documentation (Swagger) accessible
- [ ] Runbook created for on-call

## 🔒 Security Checklist

### 16. Access Control
- [ ] Admin role properly configured
- [ ] JWT secrets rotated and secure
- [ ] Platform secret key stored securely (not in code)
- [ ] Rate limiting configured
- [ ] CORS configured correctly
- [ ] SQL injection protection verified (parameterized queries)

### 17. Smart Contract Security
- [ ] Contract audit completed (if required)
- [ ] Admin address secure and backed up
- [ ] Token address correct
- [ ] Test transactions successful
- [ ] Emergency procedures documented

### 18. Data Security
- [ ] Database encrypted at rest
- [ ] Database encrypted in transit
- [ ] Backups configured
- [ ] Backup restoration tested
- [ ] Access logs enabled
- [ ] Sensitive data never logged

## 📊 Post-Deployment Verification

### 19. Smoke Tests (Production)
- [ ] Create test schedule (small amount)
- [ ] Verify schedule in database
- [ ] Query schedule via API
- [ ] Wait for cliff to pass
- [ ] Claim test tokens
- [ ] Verify claim recorded
- [ ] Check sync logs after 6 hours
- [ ] Revoke test schedule

### 20. Performance Verification
- [ ] API response times acceptable:
  - [ ] List schedules < 100ms
  - [ ] Get schedule < 50ms
  - [ ] Create schedule < 5s
  - [ ] Claim < 5s
- [ ] Worker sync time acceptable:
  - [ ] 100 schedules sync < 2 minutes
- [ ] Database queries optimized (use EXPLAIN)
- [ ] No N+1 query issues

### 21. Monitoring Verification
- [ ] Logs flowing to central system
- [ ] Metrics being collected
- [ ] Dashboards showing data
- [ ] Alerts firing (test with intentional failure)
- [ ] On-call notifications working

## 📋 Operational Readiness

### 22. Documentation Complete
- [ ] Architecture documented
- [ ] API endpoints documented
- [ ] Database schema documented
- [ ] Sync process documented
- [ ] Troubleshooting guide complete
- [ ] Runbook complete
- [ ] Monitoring guide complete

### 23. Team Training
- [ ] Developers trained on API usage
- [ ] Operators trained on monitoring
- [ ] On-call team trained on troubleshooting
- [ ] Admin team trained on schedule creation
- [ ] Support team trained on common issues

### 24. Rollback Plan
- [ ] Rollback procedure documented
- [ ] Database migration rollback tested
- [ ] Worker shutdown procedure tested
- [ ] API rollback procedure tested
- [ ] Emergency contact list complete

## 🎯 First Production Use

### 25. Initial Schedules
- [ ] First real schedule created
- [ ] Schedule verified on-chain
- [ ] Schedule visible in database
- [ ] Beneficiary can see schedule
- [ ] Email notification sent (if implemented)
- [ ] No errors in logs

### 26. First Claim
- [ ] Cliff period passed
- [ ] Beneficiary received notification (if implemented)
- [ ] Claim transaction successful
- [ ] Tokens transferred on-chain
- [ ] Claim recorded in database
- [ ] Audit trail complete
- [ ] No errors in logs

### 27. First Sync
- [ ] Sync job triggered after 6 hours
- [ ] Sync completed successfully
- [ ] Sync logs show success
- [ ] Database updated correctly
- [ ] No discrepancies between on-chain and database
- [ ] Performance acceptable

## 📈 Ongoing Operations

### 28. Daily Checks
- [ ] Review sync logs
- [ ] Check error rates
- [ ] Monitor response times
- [ ] Review recent claims
- [ ] Check for failed transactions

### 29. Weekly Reviews
- [ ] Sync success rate > 95%
- [ ] Average sync duration < 2 minutes
- [ ] No recurring errors
- [ ] Database size manageable
- [ ] Performance still acceptable

### 30. Monthly Tasks
- [ ] Review and rotate logs
- [ ] Check database indexes still optimal
- [ ] Review and update documentation
- [ ] Security audit
- [ ] Performance tuning if needed

## 🔄 Maintenance Schedule

### Regular Maintenance
- [ ] **Daily**: Monitor dashboards and alerts
- [ ] **Weekly**: Review logs and metrics
- [ ] **Monthly**: Database maintenance (VACUUM, ANALYZE)
- [ ] **Quarterly**: Security audit and dependency updates
- [ ] **Yearly**: Full system review and optimization

### Emergency Procedures
- [ ] Smart contract emergency contact: `_________________________`
- [ ] Database emergency contact: `_________________________`
- [ ] On-call rotation documented: `_________________________`
- [ ] Escalation path defined: `_________________________`

## ✅ Sign-Off

### Deployment Approval
- [ ] Technical lead sign-off: _____________ Date: _______
- [ ] Security review sign-off: _____________ Date: _______
- [ ] Operations sign-off: _____________ Date: _______
- [ ] Product owner sign-off: _____________ Date: _______

### Go-Live
- [ ] Deployment date: _____________
- [ ] Deployment time: _____________
- [ ] Deployed by: _____________
- [ ] Verified by: _____________

## 📞 Emergency Contacts

- **Development Team Lead**: _________________________
- **Operations Team Lead**: _________________________
- **Security Team**: _________________________
- **On-Call Engineer**: _________________________
- **Stellar Network Support**: support@stellar.org

## 📝 Notes

Add any deployment-specific notes, issues encountered, or deviations from the plan:

```
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

---

**Deployment Status**: 
- [ ] Not Started
- [ ] In Progress
- [ ] Completed
- [ ] Verified
- [ ] Production Ready

**Date Completed**: _____________

**Deployment Team**:
- _________________________
- _________________________
- _________________________
