import { defineConfig } from 'vitest/config';

// Integration tests run against a real MongoDB (MONGODB_URI_TEST). Each test file
// gets its own database so files can run in parallel without sharing state.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
