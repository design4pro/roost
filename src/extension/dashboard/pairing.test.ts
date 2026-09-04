import { describe, expect, it } from 'vitest'
import { DEPLOY_URL, REPO_URL, generateSecret } from './pairing'

describe('generateSecret', () => {
  it('is 256 bits of randomness', () => {
    const seen = new Set<number>()
    generateSecret((into) => {
      for (let i = 0; i < into.length; i++) into[i] = i
      seen.add(into.length)
    })
    expect(seen).toEqual(new Set([32]))
  })

  it('survives a copy, a paste and a subprotocol list', () => {
    // Base64url only: a '+', '/' or '=' would have to be escaped somewhere
    // along the way, and the key that came back would not be the key sent.
    expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('is different every time', () => {
    expect(generateSecret()).not.toBe(generateSecret())
  })
})

describe('the deploy link', () => {
  it('hands Cloudflare this repository to clone', () => {
    expect(DEPLOY_URL).toBe(
      `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`,
    )
  })
})
