jest.mock('../errorHandler', () => ({ createError: jest.fn((code: string) => Object.assign(new Error(code), { code })) }));
jest.mock('../../utils/logger.utils', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('../../services/cache.service', () => ({
  CacheService: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

const LAST_ACTIVE_DEBOUNCE_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

describe('auth.middleware lastActiveDebounce eviction', () => {
  let mod: typeof import('../auth.middleware');
  let jwt: typeof import('jsonwebtoken');
  let pool: { query: jest.Mock };

  const authenticateAs = async (userId: string) => {
    const token = jwt.sign({ sub: userId, role: 'mentee' }, process.env.JWT_SECRET as string);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await mod.authenticate(req, res, jest.fn());
  };

  const lastActiveUpdates = () =>
    pool.query.mock.calls.filter(([sql]) => /last_active_at/.test(String(sql))).length;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    jwt = require('jsonwebtoken');
    pool = require('../../config/database').default;
    pool.query.mockReset();
    // Valid, non-revoked user; everything else (UPDATE) returns no rows.
    pool.query.mockImplementation(async (sql: string) =>
      /token_invalid_before/.test(sql)
        ? { rows: [{ token_invalid_before: null, deletion_completed_at: null }] }
        : { rows: [] },
    );
    mod = require('../auth.middleware');
  });

  afterEach(() => {
    mod.stopAuthDebounceCleanup();
    jest.useRealTimers();
  });

  it('evicts entries older than LAST_ACTIVE_DEBOUNCE_MS * 2 and keeps fresh ones', async () => {
    await authenticateAs('user-old');
    expect(lastActiveUpdates()).toBe(1);

    // Same user inside the debounce window: no new update
    await authenticateAs('user-old');
    expect(lastActiveUpdates()).toBe(1);

    jest.setSystemTime(Date.now() + LAST_ACTIVE_DEBOUNCE_MS * 2 + 1);
    await authenticateAs('user-fresh');
    expect(lastActiveUpdates()).toBe(2);

    expect(mod.evictStaleDebounceEntries()).toBe(1); // only user-old
    expect(mod.evictStaleDebounceEntries()).toBe(0); // user-fresh retained

    // user-old was evicted, so it is treated as new and written again immediately
    await authenticateAs('user-old');
    expect(lastActiveUpdates()).toBe(3);
  });

  it('runs the cleanup on a 5 minute interval', async () => {
    await authenticateAs('user-a');
    expect(lastActiveUpdates()).toBe(1);

    // Interval fires after 5 minutes; entry is > 2 minutes old and is evicted
    jest.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(mod.evictStaleDebounceEntries()).toBe(0);

    await authenticateAs('user-a');
    expect(lastActiveUpdates()).toBe(2);
  });

  it('stopAuthDebounceCleanup clears the interval', () => {
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    mod.stopAuthDebounceCleanup();
    expect(jest.getTimerCount()).toBe(0);
  });
});
