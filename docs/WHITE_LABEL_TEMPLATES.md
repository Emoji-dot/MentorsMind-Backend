White-label Tenant Email Templates
=================================

Overview
--------
This feature allows tenants to supply tenant-specific email templates that override the default filesystem templates. Tenant templates are stored in database tables and cached in Redis.

Key points
- Tenant templates are stored in `tenant_email_templates` and versions in `tenant_email_template_versions`.
- Default filesystem templates (under `src/templates/emails`) are never modified by tenant operations.
- Cache key format: `template:{tenantId}:{templateName}` with 5 minute TTL. Cache is invalidated immediately on updates.
- Up to 5 historical versions are kept for rollback.

Admin API
---------
- Create/Update: POST `/api/v1/tenant/email-templates` (admin-only)
  - body: `{ tenant_id, template_name, subject_template?, html_template, text_template, variables_schema?, is_active? }`
  - rejects templates that reference undefined variables (HTTP 422)
- List: GET `/api/v1/tenant/email-templates?tenant_id=<id>` (admin-only)
- Preview: POST `/api/v1/tenant/email-templates/:name/preview` (admin-only)
  - body: `{ tenant_id, sample_data }` — renders template using provided sample data, does not send email
- Rollback: POST `/api/v1/tenant/email-templates/:name/rollback` (admin-only)
  - body: `{ tenant_id, version_id }` — atomically restores previous version

Validation
----------
The `variables_schema` can be either a JSON Schema object (with `properties`) or an array of allowed variable names. When saving a template, the service extracts `{{var}}` occurrences and ensures each variable is defined in `variables_schema`. If undefined variables exist, the API returns HTTP 422.

Notes for operators
-------------------
- Run the new database migration `database/migrations/055_create_tenant_email_templates.sql` during deployment.
- Ensure Redis is available for caching (`REDIS_URL` env var).
- Tenant overrides do not affect the packaged default templates. To update defaults, deploy code changes as before.
