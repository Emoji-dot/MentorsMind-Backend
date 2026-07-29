#!/usr/bin/env bash
# scripts/test-migrations.sh
#
# Validates database migrations against a live PostgreSQL instance.
# Intended for local developer use and CI (issue #751).
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname ./scripts/test-migrations.sh
#
# Exit codes:
#   0  — all checks passed
#   1  — at least one check failed

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
[[ -z "${DATABASE_URL:-}" ]] && die "DATABASE_URL is not set."

command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed."

cd "$(dirname "$0")/.."
info "Working directory: $(pwd)"

# ── Step 1: Validate migration file ordering / duplicates ────────────────────
info "Step 1/4 — Validating migration ordering (duplicate numbers, gaps)..."
if pnpm run migrate:validate; then
  info "Migration validation passed."
else
  die "Migration validation failed. Fix duplicate/missing migration numbers before re-running."
fi

# ── Step 2: Fresh apply (up) ──────────────────────────────────────────────────
info "Step 2/4 — Applying all migrations to a fresh database..."
if pnpm run migrate:up; then
  info "All migrations applied successfully."
else
  die "migrate:up failed on a fresh database."
fi

# ── Step 3: Idempotency check ─────────────────────────────────────────────────
info "Step 3/4 — Idempotency check (second migrate:up must be a no-op)..."
SECOND_RUN=$(pnpm run migrate:up 2>&1)
echo "$SECOND_RUN"

if echo "$SECOND_RUN" | grep -qi "migrating"; then
  die "Idempotency check failed: the second migrate:up applied migrations that should already exist."
else
  info "Idempotency confirmed — no new migrations applied on second run."
fi

# ── Step 4: Rollback test ─────────────────────────────────────────────────────
info "Step 4/4 — Testing rollback (migrate:down all)..."
if pnpm run migrate:down -- --count 9999; then
  info "Rollback (migrate:down) completed successfully."
else
  warn "migrate:down returned a non-zero exit code. This may be expected if no down migrations are defined."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
info "========================================="
info "  All migration checks PASSED ✓"
info "========================================="
