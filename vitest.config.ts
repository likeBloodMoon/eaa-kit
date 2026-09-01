import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Builds dist/ once, before any worker starts. The suites that drive a real
    // Astro, Eleventy or Nuxt build all need it, and each making its own was a
    // race: tsdown cleans the directory the others are reading.
    globalSetup: ['tests/setup/build-dist.ts'],
    environment: 'node',
    // No tests until the first feature lands — see CLAUDE.md working agreements.
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.ts'],
    },
  },
})
