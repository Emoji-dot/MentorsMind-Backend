/**
 * Minimal, dependency-free test harness for service unit tests.
 *
 * Mirrors src/validators/__tests__/test-harness.ts and
 * src/middleware/__tests__/cors-test-harness.ts so service-level suites
 * integrate with the same mental model already used in the project.
 *
 * Run via:  npm run test:smart-scheduling
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
          `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
        );
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new AssertionError(
          `expected ${JSON.stringify(actual)} to be truthy`,
        );
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new AssertionError(
          `expected ${JSON.stringify(actual)} to be falsy`,
        );
      }
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
