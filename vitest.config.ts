import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share .mosaic/ directory, must run sequentially
    fileParallelism: false,
  },
});
