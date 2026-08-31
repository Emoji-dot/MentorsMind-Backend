import type { Config } from 'jest';
import baseConfig from './jest.config';

const config: Config = {
  ...baseConfig,
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 60000,
  collectCoverage: false,
};

export default config;
