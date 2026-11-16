/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    pool: 'forks',
  },
});
