#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.join(__dirname, 'migrations');

// Get all SQL files
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'));

// Define the order (sorted logically, keeping dependencies intact)
const orderedFiles = [
  "001_create_users.sql",
  "002_create_wallets.sql",
  "003_add_timezone_support.sql",
  "003_create_transactions.sql",
  "004_create_bookings.sql",
  "005_create_reviews.sql",
  "006_create_indexes.sql",
  "007_create_triggers.sql",
  "008_create_refresh_tokens.sql",
  "009_add_indexes.sql",
  "010_create_disputes.sql",
  "011_create_learner_goals.sql",
  "012_add_meeting_url_to_sessions.sql",
  "013_add_collaboration_support_to_sessions.sql",
  "013_query_optimization.sql",
  "014_create_flags.sql",
  "014_create_notifications.sql",
  "015_analytics_views.sql",
  "016_add_reminder_flags.sql",
  "016_create_audit_logs.sql",
  "016_create_push_tokens.sql",
  "017_create_mentor_verifications.sql",
  "018_create_conversations.sql",
  "019_create_messages.sql",
  "020_advanced_analytics.sql",
  "020_create_message_attachments.sql",
  "021_learning_paths.sql",
  "021_message_search_index.sql",
  "022_create_notifications.sql",
  "022_webhooks.sql",
  "023_add_notification_preferences.sql",
  "023_create_idempotency_keys.sql",
  "023_mentor_certification.sql",
  "024_create_oauth_accounts.sql",
  "024_referral_program.sql",
  "025_add_mfa_fields.sql",
  "026_create_user_sessions.sql",
  "027_create_audit_logs.sql",
  "028_create_ip_rules.sql",
  "029_add_wallet_activation.sql",
  "030_create_stellar_operations.sql",
  "031_add_asset_fields.sql",
  "032_create_goals.sql",
  "033_create_session_notes.sql",
  "034_create_recommendation_events.sql",
  "035_create_data_export_requests.sql",
  "036_add_deletion_fields.sql",
  "037_create_webhooks.sql",
  "038_create_webhook_deliveries.sql",
  "039_add_calendar_fields.sql",
  "040_create_api_keys.sql",
  "041_add_encrypted_fields.sql",
  "042_create_consent_records.sql",
  "043_add_escrow_columns_to_bookings.sql",
  "043_create_recommendation_events.sql",
  "044_security_reliability_fixes.sql",
  "045_add_reminder_columns_to_sessions.sql",
  "046_create_system_configs.sql",
  "047_create_export_jobs.sql",
  "048_add_revocation_reason_to_refresh_tokens.sql",
  "054_add_deletion_error_tracking.sql",
  "055_add_webhook_filters.sql",
  "055_notifications_unread_first_index.sql",
  "056_create_bulk_jobs.sql",
  "056_create_goal_progress_logs.sql",
  "056_create_session_transcripts.sql",
  "057_add_api_key_to_webhooks.sql",
  "057_add_suspension_ban_fields.sql",
  "057_create_offline_queue.sql",
  "057_graphql_dataloader_bulk_and_indexes.sql",
  "058_add_user_tier.sql",
  "059_create_session_recordings.sql",
  "060_add_webhook_alert_tracking.sql",
  "061_add_on_chain_pending_to_verifications.sql",
  "062_encrypt_webhook_api_keys.sql",
  "063_encrypt_oauth_tokens.sql",
  "064_create_rotated_secrets.sql",
  "065_create_ai_moderation_results.sql",
  "065_create_session_feedback.sql",
  "065_create_subscriptions.sql",
  "066_add_mfa_sms_email.sql",
  "066_create_content_appeals.sql",
  "066_create_tax_reporting.sql",
  "067_create_calendar_integrations.sql",
  "067_enhance_dispute_system.sql",
  "068_add_public_api_keys.sql",
  "069_create_session_summaries.sql",
  "070_create_recording_transcriptions.sql",
  "071_create_recording_bookmarks.sql",
  "072_create_domain_events_and_snapshots.sql",
  "072_create_tenants.sql",
  "073_create_dynamic_pricing.sql",
  "073_create_sessions_archive.sql",
  "074_create_mentor_hybrid_config.sql",
  "074_webhook_delivery_enhancements.sql",
  "075_mentor_onboarding_enhancements.sql",
  "076_create_assessments.sql",
  "076_create_feature_flags.sql",
  "077_create_loyalty_program.sql",
  "078_create_platform_health_snapshots.sql",
  "079_create_learning_profiles.sql",
  "080_event_sourcing_enhancements.sql",
  "081_flag_placeholder_emails.sql",
  "082_stellar_tx_hash_unique.sql",
];

// Assign new numbers
const renumbered: { old: string; new: string }[] = [];
let currentNum = 1;
for (const oldFile of orderedFiles) {
  const newNum = String(currentNum).padStart(3, '0');
  const rest = oldFile.split('_').slice(1).join('_');
  const newFile = `${newNum}_${rest}`;
  renumbered.push({ old: oldFile, new: newFile });
  currentNum++;
}

// Write manifest
const manifestPath = path.join(__dirname, 'MANIFEST.md');
let manifestContent = `# Database Migration Manifest\n\nThis file documents the complete list of database migrations in the order they should be applied.\n\n## Migration List\n\n| Number | Filename | Purpose |\n|--------|----------|---------|\n`;

for (const entry of renumbered) {
  const purpose = entry.new.split('_').slice(1).join(' ').replace('.sql', '');
  manifestContent += `| ${entry.new.split('_')[0]} | ${entry.new} | ${purpose} |\n`;
}

fs.writeFileSync(manifestPath, manifestContent);

console.log('Renumber plan:');
for (const entry of renumbered) {
  console.log(`  ${entry.old} → ${entry.new}`);
}

// Perform the renames (commented out for safety; uncomment to run)
for (const entry of renumbered) {
  const oldPath = path.join(migrationsDir, entry.old);
  const newPath = path.join(migrationsDir, entry.new);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed ${entry.old} to ${entry.new}`);
  }
}
