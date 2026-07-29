# Security Scanning Runbook (issue #785)

The CI pipeline (`.github/workflows/deploy.yml`) runs a `security-scan` job
in parallel with the build/type-check job on every push and pull request.
Production deploys (`deploy-api`) wait on **both** `ci` and `security-scan`.

## What runs, and where

| Check | Where | Gate |
|---|---|---|
| `pnpm audit --audit-level=high` | `ci` job | Fails the build on any HIGH/CRITICAL dependency vulnerability |
| OWASP ZAP baseline scan | `security-scan` job | Fails the build per `.zap/rules.tsv` thresholds (see below) |
| Security headers check | `security-scan` job (`security-headers-check.ts`) | Fails if any required header is missing/invalid |

The ZAP report is uploaded as the `security-scan-report` artifact
(`security-scan-report.html`), retained for 90 days.

## OWASP ZAP configuration

- **Target**: the test server, started against `.env.test` with a disposable
  Postgres/Redis pair provisioned as GitHub Actions services.
- **Context** (`.zap/context.xml`): scopes the scan to `/api/v{n}/*` and
  excludes `/api/v*/docs*`, `/health*`, `/metrics`, and `/api/versions` —
  these are either static documentation assets or intentionally-verbose
  operational endpoints, not application attack surface.
- **Rule thresholds** (`.zap/rules.tsv`): most rules use ZAP's default WARN
  threshold. Injection-class findings (reflected/stored XSS, SQL injection —
  rule IDs `40012`–`40022`) are explicitly escalated to `FAIL` regardless of
  default. Cookie-flag findings on `/health` and `/metrics` are ignored —
  those endpoints carry no session state.
- **Authentication** (`.zap/auth-script.js`): the CI job registers and logs
  in a disposable test user, then passes the resulting JWT to ZAP via the
  `ZAP_AUTH_TOKEN` environment variable. The script stamps every scanned
  request with `Authorization: Bearer <token>` so authenticated routes are
  actually exercised, not just the public ones.

## Triage process for a new finding

1. **Confirm it's not a known false positive.** Check whether the path is
   already excluded in `.zap/context.xml` or the rule already has a
   threshold override in `.zap/rules.tsv`. If it's a new false positive
   (e.g. a new static/docs-only route), add an exclusion — but explain why
   in a comment, and prefer narrowing the regex over broadening it.
2. **If it's real:** treat HIGH-risk findings (injection, broken access
   control, security misconfiguration) as release blockers — fix before
   merging. MEDIUM/LOW findings should get a tracked follow-up issue if not
   fixed immediately.
3. **Dependency vulnerabilities** (`pnpm audit`): prefer a patch/minor bump
   of the flagged package. If no fix is available yet, document the
   accepted risk and re-run `pnpm audit` on a schedule until one ships —
   don't silence the finding by lowering `--audit-level`.

## Running locally

```bash
# Security headers, against a locally running server:
SECURITY_CHECK_BASE_URL=http://localhost:5000/api/v1 pnpm run security:headers-check

# Full ZAP scan against a local Docker environment (requires Docker):
ZAP_TARGET_URL=http://host.docker.internal:5000/api/v1 pnpm run security:scan
```

## Known limitations / follow-ups

- The baseline scan is passive-plus-light-active (`zap-baseline.py`); the
  deeper `zap-full-scan.py` used by `pnpm run security:scan` is intentionally
  **not** run in CI (it's slow and noisier) — run it locally or in a
  scheduled (non-blocking) workflow before a major release.
- `zaproxy/action-baseline`'s exact mechanism for loading an HTTP Sender
  script varies by version; verify `cmd_options` against the action version
  pinned in `deploy.yml` and adjust if the action's interface changes.
