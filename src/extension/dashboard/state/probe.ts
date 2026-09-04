/**
 * Is there a hub at this address, and does it accept this key?
 *
 * The two answers the onboarding has to tell apart are "wrong key" and "wrong
 * address", because they need different corrections from the user. Anything
 * that is neither - a 500, a page that is not a hub at all - is reported as
 * unreachable, which is what it is from here.
 */
export type ProbeResult = 'ok' | 'wrong_key' | 'unreachable'

export async function probeWorker(
  url: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<ProbeResult> {
  let response: Response
  try {
    response = await fetcher(new URL('/api/health', url).toString(), {
      headers: { authorization: `Bearer ${secret}` },
    })
  } catch {
    return 'unreachable'
  }

  if (response.status === 204 || response.status === 200) return 'ok'
  if (response.status === 401 || response.status === 403) return 'wrong_key'
  return 'unreachable'
}
