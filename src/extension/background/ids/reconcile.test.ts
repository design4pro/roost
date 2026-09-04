import { describe, expect, it } from 'vitest'
import type { LocalWindow, RemoteWindow } from './reconcile'
import { matchWindows } from './reconcile'

const win = (chromeId: number, urls: string[]): LocalWindow => ({
  chromeId,
  tabs: urls.map((url) => ({ url, pinned: false })),
})

const remote = (id: string, urls: string[]): RemoteWindow => ({
  id,
  tabs: urls.map((url) => ({ url, pinned: false })),
})

describe('reconciling windows after a restart', () => {
  it('adopts the old id for a window Chrome restored', () => {
    const result = matchWindows(
      [win(1, ['https://a.test', 'https://b.test'])],
      [remote('w1', ['https://a.test', 'https://b.test'])],
    )
    expect(result).toEqual({
      pairs: [{ chromeId: 1, id: 'w1' }],
      newLocal: [],
      staleRemote: [],
    })
  })

  it('still recognises a window that lost a tab', () => {
    const result = matchWindows(
      [win(1, ['https://a.test', 'https://b.test'])],
      [remote('w1', ['https://a.test', 'https://b.test', 'https://c.test'])],
    )
    expect(result.pairs).toEqual([{ chromeId: 1, id: 'w1' }])
  })

  it('does not pair windows that merely overlap', () => {
    const result = matchWindows(
      [win(1, ['https://a.test'])],
      [
        remote('w1', [
          'https://a.test',
          'https://b.test',
          'https://c.test',
          'https://d.test',
        ]),
      ],
    )
    expect(result).toEqual({ pairs: [], newLocal: [1], staleRemote: ['w1'] })
  })

  it('gives each window its best match, not its first', () => {
    const result = matchWindows(
      [win(1, ['https://a.test', 'https://b.test'])],
      [
        remote('w1', ['https://a.test', 'https://x.test']),
        remote('w2', ['https://a.test', 'https://b.test']),
      ],
    )
    expect(result.pairs).toEqual([{ chromeId: 1, id: 'w2' }])
    expect(result.staleRemote).toEqual(['w1'])
  })

  it('reports windows opened and closed while the browser was shut', () => {
    const result = matchWindows(
      [win(1, ['https://new.test'])],
      [remote('w1', ['https://gone.test'])],
    )
    expect(result).toEqual({ pairs: [], newLocal: [1], staleRemote: ['w1'] })
  })

  it('tells a pinned tab from an ordinary one', () => {
    const result = matchWindows(
      [{ chromeId: 1, tabs: [{ url: 'https://a.test', pinned: true }] }],
      [{ id: 'w1', tabs: [{ url: 'https://a.test', pinned: false }] }],
    )
    expect(result.pairs).toEqual([])
  })

  it('has nothing to do on a first run', () => {
    expect(matchWindows([], [])).toEqual({
      pairs: [],
      newLocal: [],
      staleRemote: [],
    })
  })
})
