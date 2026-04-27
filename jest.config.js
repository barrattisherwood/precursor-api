module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: './tests/setup/mongo-setup.ts',
  globalTeardown: './tests/setup/mongo-teardown.ts',
  testTimeout: 30000,
  maxWorkers: 1, // shared MongoMemoryServer — run sequentially for isolation
};
