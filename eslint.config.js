//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

/**
 * The layering law from docs/ARCHITECTURE.md, expressed as import bans.
 *
 * Three rules, each one direction of the same shape: `src/shared` is the only
 * module both ends may depend on, so it may depend on neither of them; the
 * dashboard reaches the service worker through one typed port and never through
 * its internals; and the Worker shares nothing with the extension but `shared`.
 */
const layering = [
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['#/extension/*', '#/worker/*', 'wxt', 'wxt/*'],
              message:
                'src/shared is the neutral layer both ends import (docs/ARCHITECTURE.md). It depends on neither.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/extension/dashboard/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['#/extension/background/*', '#/worker/*'],
              message:
                'The dashboard talks to the service worker through #/extension/port/protocol only (docs/ARCHITECTURE.md).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/worker/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['#/extension/*', 'wxt', 'wxt/*'],
              message:
                'The Worker shares only src/shared with the extension (docs/ARCHITECTURE.md).',
            },
          ],
        },
      ],
    },
  },
]

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  ...layering,
  {
    // Not in any tsconfig, so the typed parser reports every file in them as a
    // project-membership error: generated output, vendored agent tooling, and
    // test artefacts. The same paths .gitignore already refuses to track.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      '.wxt/**',
      '.output/**',
      '.wrangler/**',
      '.github/**',
      '.claude/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'worker-configuration.d.ts',
    ],
  },
]
