import { describe, expect, it } from 'vitest'
import { probeWorker } from './probe'

const answering = (status: number) =>
  (() => Promise.resolve({ status } as Response)) as unknown as typeof fetch

describe('probeWorker', () => {
  it.each([
    ['a hub that accepts the key', 204, 'ok'],
    ['a hub answering 200 for it', 200, 'ok'],
    ['a key the hub refuses', 401, 'wrong_key'],
    ['a key it refuses more firmly', 403, 'wrong_key'],
    ['something that is not a hub', 500, 'unreachable'],
    ['a route that does not exist there', 404, 'unreachable'],
  ])('reads %s', async (_name, status, expected) => {
    await expect(
      probeWorker('https://sync.example.com', 'key', answering(status)),
    ).resolves.toBe(expected)
  })

  it('treats a network failure as unreachable', async () => {
    const failing = (() =>
      Promise.reject(new Error('nope'))) as unknown as typeof fetch
    await expect(
      probeWorker('https://sync.example.com', 'key', failing),
    ).resolves.toBe('unreachable')
  })

  it('asks the health route with the key, and never in the URL', async () => {
    const seen: Array<[string, RequestInit | undefined]> = []
    const recording = ((input: string, init?: RequestInit) => {
      seen.push([input, init])
      return Promise.resolve({ status: 204 } as Response)
    }) as unknown as typeof fetch

    await probeWorker('https://sync.example.com/', 'k3y', recording)

    expect(seen[0]?.[0]).toBe('https://sync.example.com/api/health')
    expect(seen[0]?.[1]?.headers).toEqual({ authorization: 'Bearer k3y' })
  })
})
