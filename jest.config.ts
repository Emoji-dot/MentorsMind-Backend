import type { Config } from 'jest';

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
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }],
    // ESM-only packages (e.g. uuid@13) must be transpiled to CJS for Jest.
    '^.+\\.m?js$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        module: 'commonjs',
        target: 'ES2022',
        esModuleInterop: true,
        skipLibCheck: true,
      },
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/)?uuid)',
  ],
};

export default config;
