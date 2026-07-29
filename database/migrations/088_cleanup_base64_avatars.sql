-- Migration 088: Clean up base64-encoded avatar_url values
--
-- Context:
--   Prior to issue #644, the POST /users/avatar endpoint stored the raw
--   base64-encoded image string directly in the users.avatar_url column.
--   This caused:
--     • Massive row sizes bloating the DB (multi-MB blobs per user)
--     • Slow queries on the users table
--     • No CDN / image optimisation pipeline
--
-- This migration nulls out any avatar_url values that look like base64
-- image data (data URIs or raw base64 strings) so that:
--   1. The column only ever contains a valid HTTPS URL going forward.
--   2. Existing base64 blobs are removed to reclaim DB storage.
--
-- After this migration, all new avatar uploads go through UploadService,
-- which resizes the image to 256×256 JPEG and stores it in S3, then
-- saves the CloudFront / S3 HTTPS URL in avatar_url.
--
-- Safety: only rows where avatar_url starts with 'data:image/' (data URI)
-- or consists entirely of base64 characters without a leading 'https://'
-- are affected. Legitimate S3/CloudFront URLs are left untouched.

-- Step 1: Null out data-URI base64 avatars  (e.g. "data:image/png;base64,...")
UPDATE users
SET    avatar_url = NULL,
       updated_at = NOW()
WHERE  avatar_url IS NOT NULL
  AND  avatar_url LIKE 'data:image/%';

-- Step 2: Null out raw base64 strings that are clearly not HTTPS URLs.
-- A raw base64 string will NOT start with 'http' and will be very long.
-- We use a conservative length threshold (> 256 chars) to avoid touching
-- any short legitimate URLs that happened to slip through validation.
UPDATE users
SET    avatar_url = NULL,
       updated_at = NOW()
WHERE  avatar_url IS NOT NULL
  AND  avatar_url NOT LIKE 'http%'
  AND  LENGTH(avatar_url) > 256;

-- Step 3: Run VACUUM ANALYZE to reclaim the freed storage and update planner stats.
-- (VACUUM cannot run inside a transaction; the migration runner must execute
--  this outside a transaction block, or a DBA can run it separately.)
-- VACUUM ANALYZE users;
