import type { Config } from "jest";

const config: Config = {
  displayName: "unit",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.unit.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          target: "ES2020",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: ["node", "jest"],
        },
        diagnostics: {
          ignoreCodes: [1343, 2345, 7006],
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverage: false,
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
};

export default config;
