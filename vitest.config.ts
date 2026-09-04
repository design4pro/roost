import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

export default defineConfig({
  test: {
    globals: false,
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['src/shared/**/*.test.ts'],
        },
      },
      {
        plugins: [WxtVitest()],
        test: {
          name: 'extension',
          environment: 'jsdom',
          include: ['src/extension/**/*.test.{ts,tsx}'],
          setupFiles: ['src/extension/test/setup.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // The Durable Object under test talks to itself over WebSockets,
              // and a socket outlives the request that opened it. Per-file
              // storage isolation resets the object between those two facts and
              // the socket ends up attached to an object that no longer exists,
              // so tests share one instance and take their isolation from a
              // unique DO name per test instead.
              durableObjects: {
                USER_HUB: { className: 'UserHub', useSQLite: true },
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['src/worker/**/*.test.ts'],
          isolate: false,
          maxWorkers: 1,
          // Running single-threaded makes this project's scheduling differ from
          // the rest, and Vitest refuses to put projects that disagree about it
          // in one group. Its own group also means the worker runtime does not
          // have to boot alongside the node and jsdom suites.
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'tooling',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      // Istanbul, not the house default V8: the Workers pool runs tests inside
      // workerd, which does not expose V8's coverage profiler.
      provider: 'istanbul',
      // Only what is actually executable: the uncovered-file pass parses
      // everything it is pointed at, and markup, styles and locale files are
      // not JavaScript.
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.*',
        'src/extension/test/**',
        'src/**/__fixtures__/**',
      ],
      thresholds: {
        'src/shared/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        'src/extension/background/**': {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        'src/worker/user-hub/**': {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
})
