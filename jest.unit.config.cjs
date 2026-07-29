module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/services/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2020',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: ['node', 'jest'],
        },
        diagnostics: {
          ignoreCodes: [1343, 2345, 7006],
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(uuid)/)'],
};
