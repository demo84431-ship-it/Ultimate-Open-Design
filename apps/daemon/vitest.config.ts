import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx,js,mjs,cjs}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000,
  },
});
