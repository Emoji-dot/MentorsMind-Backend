# Email Assets — CDN-hosted Resources

This directory contains the source assets for email templates. In production, these
files must be uploaded to your configured CDN (CloudFront / Cloudflare / Fastly)
under the path `/assets/emails/`.

## Required Assets

| File path                        | Usage                               |
|----------------------------------|-------------------------------------|
| `logo.png`                       | Header logo (180px wide, white bg)  |
| `logo-white.png`                 | White variant for dark backgrounds  |
| `icons/twitter.png`              | Twitter / X social icon (24×24)     |
| `icons/linkedin.png`             | LinkedIn social icon (24×24)        |
| `icons/facebook.png`             | Facebook social icon (24×24)        |
| `icons/instagram.png`            | Instagram social icon (24×24)       |
| `icons/check.png`                | Confirmation / success icon (24×24) |
| `icons/warning.png`              | Warning / alert icon (24×24)        |
| `icons/calendar.png`             | Calendar / booking icon (24×24)     |
| `avatar-placeholder.png`         | Default user avatar (60×60)         |

## Why CDN-hosting matters

Email clients (Outlook, corporate firewalls) often block images from third-party
hosts like Flaticon. All icon and logo references in Handlebars templates
(`base-layout.hbs` etc.) now use `{{twitterIconUrl}}`, `{{linkedinIconUrl}}`,
`{{logoUrl}}` etc., which resolve to your CDN via `EmailCDNService.getTemplateVariables()`.

## Uploading to CDN

```bash
# Example: sync to AWS S3 (CloudFront origin bucket)
aws s3 sync ./public/assets/emails/ s3://<bucket>/assets/emails/ \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "image/png"

# Then invalidate the CloudFront distribution cache
aws cloudfront create-invalidation \
  --distribution-id $CDN_CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/assets/emails/*"
```

## Environment variables

See `.env.example` for `CDN_BASE_URL`, `EMAIL_ASSETS_BASE_URL`, and related settings.
