/**
 * TenantContext — AsyncLocalStorage-based tenant isolation utility.
 *
 * Provides the following capabilities:
 *
 *  1. TenantContext.run(tenantId, fn)   — execute fn inside a tenant scope
 *  2. TenantContext.getTenantId()       — retrieve the current tenant ID (or null)
 *  3. TenantContext.requireTenantId()   — same but throws when not set
 *  4. withTenantFilter(query, params)   — append AND tenant_id = $N to a SQL query
 *  5. ADMIN_BYPASS_TENANT_ID            — sentinel value that disables tenant filters
 *
 * Design notes
 * ─────────────
 * • Uses Node.js built-in `AsyncLocalStorage` (Node 16+, stable in Node 18+).
 * • No external dependencies.
 * • The storage holds a plain `TenantStore` object so we can extend it later
 *   (e.g. add impersonation flags) without breaking the public API.
 * • `withTenantFilter` is a pure utility — it does not query the store itself;
 *   callers pass `tenantId` explicitly so models can use it directly.
 *
 * Performance
 * ──────────────
 * AsyncLocalStorage adds ~1–3 µs overhead per operation — well inside the
 * < 5 ms per-query budget stated in the acceptance criteria.
 */

import { AsyncLocalStorage } from 'async_hooks';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantStore {
  /** UUID of the current tenant, or null for system/admin contexts. */
  tenantId: string | null;
}

// ─── Sentinel ─────────────────────────────────────────────────────────────────

/**
 * Pass this as `tenantId` to `withTenantFilter` to skip all tenant filtering.
 * Intended only for admin / super-admin queries that genuinely cross tenants.
 */
export const ADMIN_BYPASS_TENANT_ID = '__ADMIN_BYPASS__' as const;

// ─── Storage ──────────────────────────────────────────────────────────────────

const storage = new AsyncLocalStorage<TenantStore>();

// ─── TenantContext ────────────────────────────────────────────────────────────

export const TenantContext = {
  /**
   * Execute `fn` inside a tenant-scoped async context.
   *
   * @param tenantId  UUID string of the tenant (or `null` for admin bypass).
   * @param fn        Async or sync callback to run in the scoped context.
   */
  run<T>(tenantId: string | null, fn: () => T): T {
    return storage.run({ tenantId }, fn);
  },

  /**
   * Returns the current tenant ID, or `null` when running outside a tenant
   * context (e.g. background jobs, health checks).
   */
  getTenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  },

  /**
   * Returns the current tenant ID, throwing if the context was not set.
   * Use this in models / services where a tenant context is mandatory.
   *
   * @throws {Error} When no tenant context has been established.
   */
  requireTenantId(): string {
    const id = TenantContext.getTenantId();
    if (!id) {
      throw new Error(
        'No tenant context found. Ensure tenantMiddleware ran before this call.',
      );
    }
    return id;
  },

  /**
   * Returns `true` when there is an active tenant context (tenantId is set
   * and is not the admin bypass sentinel).
   */
  hasTenantContext(): boolean {
    const id = TenantContext.getTenantId();
    return id !== null && id !== ADMIN_BYPASS_TENANT_ID;
  },

  /**
   * Returns `true` when the current context is an admin bypass context.
   * Use this to guard cross-tenant admin operations.
   */
  isAdminBypass(): boolean {
    return TenantContext.getTenantId() === ADMIN_BYPASS_TENANT_ID;
  },
} as const;

// ─── withTenantFilter ─────────────────────────────────────────────────────────

/**
 * Appends `AND tenant_id = $N` to an existing SQL query unless `tenantId` is
 * the admin bypass sentinel or null.
 *
 * The function is intentionally pure — it does not read AsyncLocalStorage
 * itself so it can be used safely from both middleware and model layers.
 *
 * @param query     SQL string (SELECT … WHERE …).  Must already have a WHERE
 *                  clause, or end with a WHERE-compatible position where the
 *                  tenant predicate can be appended via AND.
 * @param params    Existing positional parameter array.
 * @param tenantId  Tenant UUID to filter by, or null / ADMIN_BYPASS_TENANT_ID
 *                  to skip filtering.
 * @param column    Name of the tenant column (default: `tenant_id`).
 *
 * @returns `{ query, params }` ready to be passed to `pool.query`.
 *
 * @example
 * const tenantId = TenantContext.getTenantId();
 * const { query, params } = withTenantFilter(
 *   'SELECT * FROM bookings WHERE status = $1',
 *   ['confirmed'],
 *   tenantId,
 * );
 * // If tenantId = 'abc-123', produces:
 * //   query  → 'SELECT * FROM bookings WHERE status = $1 AND tenant_id = $2'
 * //   params → ['confirmed', 'abc-123']
 */
export function withTenantFilter(
  query: string,
  params: unknown[],
  tenantId: string | null,
  column = 'tenant_id',
): { query: string; params: unknown[] } {
  // Skip filter for null or admin bypass
  if (!tenantId || tenantId === ADMIN_BYPASS_TENANT_ID) {
    return { query, params };
  }

  const nextIdx = params.length + 1;

  // If the query has no WHERE clause yet, add one; otherwise AND-extend it.
  const upperQuery = query.trimEnd().toUpperCase();
  const hasWhere = /\bWHERE\b/.test(upperQuery);

  const separator = hasWhere ? ' AND ' : ' WHERE ';
  const filteredQuery = `${query.trimEnd()}${separator}${column} = $${nextIdx}`;

  return {
    query: filteredQuery,
    params: [...params, tenantId],
  };
}

/**
 * Convenience overload that reads the tenant ID from the current
 * AsyncLocalStorage context automatically.
 *
 * Equivalent to:
 * ```ts
 * withTenantFilter(query, params, TenantContext.getTenantId(), column)
 * ```
 */
export function withCurrentTenantFilter(
  query: string,
  params: unknown[],
  column = 'tenant_id',
): { query: string; params: unknown[] } {
  return withTenantFilter(query, params, TenantContext.getTenantId(), column);
}
