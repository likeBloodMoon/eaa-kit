import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // No tests until the first feature lands — see CLAUDE.md working agreements.
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.ts'],
    },
  },
})
