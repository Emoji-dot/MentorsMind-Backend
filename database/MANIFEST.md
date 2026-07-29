# Database Migration Manifest

This file documents the complete list of database migrations in the order they should be applied.

## Migration List

| Number | Filename | Purpose |
|--------|----------|---------|
| 001 | 001_create_users.sql | create users |
| 002 | 002_create_wallets.sql | create wallets |
| 003 | 003_add_timezone_support.sql | add timezone support |
| 004 | 004_create_transactions.sql | create transactions |
| 005 | 005_create_bookings.sql | create bookings |
| 006 | 006_create_reviews.sql | create reviews |
| 007 | 007_create_indexes.sql | create indexes |
| 008 | 008_create_triggers.sql | create triggers |
| 009 | 009_create_refresh_tokens.sql | create refresh tokens |
| 010 | 010_add_indexes.sql | add indexes |
| 011 | 011_create_disputes.sql | create disputes |
| 012 | 012_create_learner_goals.sql | create learner goals |
| 013 | 013_add_meeting_url_to_sessions.sql | add meeting url to sessions |
| 014 | 014_add_collaboration_support_to_sessions.sql | add collaboration support to sessions |
| 015 | 015_query_optimization.sql | query optimization |
| 016 | 016_create_flags.sql | create flags |
| 017 | 017_create_notifications.sql | create notifications |
| 018 | 018_analytics_views.sql | analytics views |
| 019 | 019_add_reminder_flags.sql | add reminder flags |
| 020 | 020_create_audit_logs.sql | create audit logs |
| 021 | 021_create_push_tokens.sql | create push tokens |
| 022 | 022_create_mentor_verifications.sql | create mentor verifications |
| 023 | 023_create_conversations.sql | create conversations |
| 024 | 024_create_messages.sql | create messages |
| 025 | 025_advanced_analytics.sql | advanced analytics |
| 026 | 026_create_message_attachments.sql | create message attachments |
| 027 | 027_learning_paths.sql | learning paths |
| 028 | 028_message_search_index.sql | message search index |
| 029 | 029_create_notifications.sql | create notifications |
| 030 | 030_webhooks.sql | webhooks |
| 031 | 031_add_notification_preferences.sql | add notification preferences |
| 032 | 032_create_idempotency_keys.sql | create idempotency keys |
| 033 | 033_mentor_certification.sql | mentor certification |
| 034 | 034_create_oauth_accounts.sql | create oauth accounts |
| 035 | 035_referral_program.sql | referral program |
| 036 | 036_add_mfa_fields.sql | add mfa fields |
| 037 | 037_create_user_sessions.sql | create user sessions |
| 038 | 038_create_audit_logs.sql | create audit logs |
| 039 | 039_create_ip_rules.sql | create ip rules |
| 040 | 040_add_wallet_activation.sql | add wallet activation |
| 041 | 041_create_stellar_operations.sql | create stellar operations |
| 042 | 042_add_asset_fields.sql | add asset fields |
| 043 | 043_create_goals.sql | create goals |
| 044 | 044_create_session_notes.sql | create session notes |
| 045 | 045_create_recommendation_events.sql | create recommendation events |
| 046 | 046_create_data_export_requests.sql | create data export requests |
| 047 | 047_add_deletion_fields.sql | add deletion fields |
| 048 | 048_create_webhooks.sql | create webhooks |
| 049 | 049_create_webhook_deliveries.sql | create webhook deliveries |
| 050 | 050_add_calendar_fields.sql | add calendar fields |
| 051 | 051_create_api_keys.sql | create api keys |
| 052 | 052_add_encrypted_fields.sql | add encrypted fields |
| 053 | 053_create_consent_records.sql | create consent records |
| 054 | 054_add_escrow_columns_to_bookings.sql | add escrow columns to bookings |
| 055 | 055_create_recommendation_events.sql | create recommendation events |
| 056 | 056_security_reliability_fixes.sql | security reliability fixes |
| 057 | 057_add_reminder_columns_to_sessions.sql | add reminder columns to sessions |
| 058 | 058_create_system_configs.sql | create system configs |
| 059 | 059_create_export_jobs.sql | create export jobs |
| 060 | 060_add_revocation_reason_to_refresh_tokens.sql | add revocation reason to refresh tokens |
| 061 | 061_add_deletion_error_tracking.sql | add deletion error tracking |
| 062 | 062_add_webhook_filters.sql | add webhook filters |
| 063 | 063_notifications_unread_first_index.sql | notifications unread first index |
| 064 | 064_create_bulk_jobs.sql | create bulk jobs |
| 065 | 065_create_goal_progress_logs.sql | create goal progress logs |
| 066 | 066_create_session_transcripts.sql | create session transcripts |
| 067 | 067_add_api_key_to_webhooks.sql | add api key to webhooks |
| 068 | 068_add_suspension_ban_fields.sql | add suspension ban fields |
| 069 | 069_create_offline_queue.sql | create offline queue |
| 070 | 070_graphql_dataloader_bulk_and_indexes.sql | graphql dataloader bulk and indexes |
| 071 | 071_add_user_tier.sql | add user tier |
| 072 | 072_create_session_recordings.sql | create session recordings |
| 073 | 073_add_webhook_alert_tracking.sql | add webhook alert tracking |
| 074 | 074_add_on_chain_pending_to_verifications.sql | add on chain pending to verifications |
| 075 | 075_encrypt_webhook_api_keys.sql | encrypt webhook api keys |
| 076 | 076_encrypt_oauth_tokens.sql | encrypt oauth tokens |
| 077 | 077_create_rotated_secrets.sql | create rotated secrets |
| 078 | 078_create_ai_moderation_results.sql | create ai moderation results |
| 079 | 079_create_session_feedback.sql | create session feedback |
| 080 | 080_create_subscriptions.sql | create subscriptions |
| 081 | 081_add_mfa_sms_email.sql | add mfa sms email |
| 082 | 082_create_content_appeals.sql | create content appeals |
| 083 | 083_create_tax_reporting.sql | create tax reporting |
| 084 | 084_create_calendar_integrations.sql | create calendar integrations |
| 085 | 085_enhance_dispute_system.sql | enhance dispute system |
| 086 | 086_add_public_api_keys.sql | add public api keys |
| 087 | 087_create_session_summaries.sql | create session summaries |
| 088 | 088_create_recording_transcriptions.sql | create recording transcriptions |
| 089 | 089_create_recording_bookmarks.sql | create recording bookmarks |
| 090 | 090_create_domain_events_and_snapshots.sql | create domain events and snapshots |
| 091 | 091_create_tenants.sql | create tenants |
| 092 | 092_create_dynamic_pricing.sql | create dynamic pricing |
| 093 | 093_create_sessions_archive.sql | create sessions archive |
| 094 | 094_create_mentor_hybrid_config.sql | create mentor hybrid config |
| 095 | 095_webhook_delivery_enhancements.sql | webhook delivery enhancements |
| 096 | 096_mentor_onboarding_enhancements.sql | mentor onboarding enhancements |
| 097 | 097_create_assessments.sql | create assessments |
| 098 | 098_create_feature_flags.sql | create feature flags |
| 099 | 099_create_loyalty_program.sql | create loyalty program |
| 100 | 100_create_platform_health_snapshots.sql | create platform health snapshots |
| 101 | 101_create_learning_profiles.sql | create learning profiles |
| 102 | 102_event_sourcing_enhancements.sql | event sourcing enhancements |
| 103 | 103_flag_placeholder_emails.sql | flag placeholder emails |
| 104 | 104_stellar_tx_hash_unique.sql | stellar tx hash unique |
