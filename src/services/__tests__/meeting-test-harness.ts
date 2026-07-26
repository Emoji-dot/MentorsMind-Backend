/**
 * Minimal test harness for meeting service tests.
 *
 * Mirrors the existing harness in src/validators/__tests__/test-harness.ts.
 * Run all tests via:  npm run test:meeting
 */

type TestFn = () => void | Promise<void>;

interface TestCase {
  suite: string;
  name: string;
  fn: TestFn;
}

const cases: TestCase[] = [];
let currentSuite = '';

export function describe(name: string, fn: () => void): void {
  currentSuite = name;
  fn();
  currentSuite = '';
}

export function it(name: string, fn: TestFn): void {
  cases.push({ suite: currentSuite, name, fn });
}

class AssertionError extends Error {}

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new AssertionError(
          `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`
        );
      }
    },
    toEqual(expected: unknown) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        throw new AssertionError(`expected ${a} to equal ${b}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new AssertionError(`expected ${JSON.stringify(actual)} to be truthy`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new AssertionError(`expected ${JSON.stringify(actual)} to be falsy`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new AssertionError(`expected ${JSON.stringify(actual)} to be null`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null) {
          throw new AssertionError('expected value not to be null');
        }
      },
      toBe(expected: unknown) {
        if (actual === expected) {
          throw new AssertionError(
            `expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`
          );
        }
      },
    },
    toBeGreaterThan(n: number) {
      if (typeof actual !== 'number' || actual <= n) {
        throw new AssertionError(`expected ${JSON.stringify(actual)} to be greater than ${n}`);
      }
    },
    toContain(substring: string) {
      if (typeof actual !== 'string' || !actual.includes(substring)) {
        throw new AssertionError(
          `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(substring)}`
        );
      }
    },
    toThrow() {
      if (typeof actual !== 'function') {
        throw new AssertionError('toThrow() requires a function');
      }
      let threw = false;
      try {
        (actual as () => unknown)();
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new AssertionError('expected function to throw');
      }
    },
    toReject() {
      // async — returns a Promise; call await expect(fn).toReject()
      if (typeof actual !== 'function') {
        throw new AssertionError('toReject() requires a function');
      }
      return (async () => {
        let threw = false;
        try {
          await (actual as () => Promise<unknown>)();
        } catch {
          threw = true;
        }
        if (!threw) {
          throw new AssertionError('expected async function to reject');
        }
      })();
    },
  };
}

export async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const label = `${testCase.suite} > ${testCase.name}`;
    try {
      await testCase.fn();
      passed++;
      process.stdout.write(`  ✓ ${label}\n`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  ✗ ${label}\n    ${message}\n`);
    }
  }

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
