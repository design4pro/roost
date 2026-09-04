import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The message files are data, and data drifts: a key added in one language and
 * not the other shows up as `!some_key` on screen, in production, in the
 * language the author does not use.
 */
const LOCALES = path.resolve('src/extension/public/_locales')
const SOURCE = path.resolve('src/extension')

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(path.join(LOCALES, locale, 'messages.json'), 'utf8'),
  ) as Record<string, { message: string }>

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [full]
      : []
  })

describe('the message catalogue', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(messages('pl')).sort()).toEqual(
      Object.keys(messages('en')).sort(),
    )
  })

  it('translates every key the code asks for', () => {
    const known = new Set(Object.keys(messages('en')))
    const used = new Set<string>()

    for (const file of sourceFiles(SOURCE)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\bt\('([a-z0-9_]+)'/g)) {
        used.add(match[1] as string)
      }
    }

    expect([...used].filter((key) => !known.has(key))).toEqual([])
  })

  it('keeps the same placeholders in every language', () => {
    const en = messages('en')
    const pl = messages('pl')
    for (const [key, value] of Object.entries(en)) {
      const placeholders = (text: string) =>
        [...text.matchAll(/\$(\w+)\$/g)].map((m) => m[1]).sort()
      expect([key, placeholders(pl[key]?.message ?? '')]).toEqual([
        key,
        placeholders(value.message),
      ])
    }
  })
})
