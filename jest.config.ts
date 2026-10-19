import type { Config } from 'jest';

// Shared by every `transform` entry (see the comment below). tsconfig.json is
// read from the project root and these options are merged on top of it.
// `allowJs` is required so that ESM-only dependencies (e.g. uuid@13) are
// transpiled to CommonJS instead of being handed to Jest as raw ESM.
const tsJestOptions = {
  tsconfig: {
    allowJs: true,
  },
};

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts', '<rootDir>/src/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
  },
  transform: {
    // ts-jest caches a single ConfigSet per Jest project config, so every
    // `transform` entry MUST declare the same options. Giving the `.js` entry its
    // own inline tsconfig is silently ignored: the first entry's config is reused
    // for all files. `allowJs` is therefore enabled once, globally, and inherited
    // from tsconfig.json for everything else.
    '^.+\\.tsx?$': ['ts-jest', tsJestOptions],
    // ESM-only dependencies (e.g. uuid@13) are transpiled to CommonJS here.
    '^.+\\.m?js$': ['ts-jest', tsJestOptions],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/)?uuid)',
  ],
};

export default config;
