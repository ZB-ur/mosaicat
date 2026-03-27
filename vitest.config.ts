import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share .mosaic/ directory, must run sequentially
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/mcp-entry.ts',
      ],
      thresholds: {
        lines: 15,
      },
    },
  },
});
