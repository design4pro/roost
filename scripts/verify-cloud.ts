/**
 * The one question a machine can answer about a deployed hub.
 *
 * It stands on a public `workers.dev` address with nothing but the pairing key
 * in front of it, so the only check worth automating is that the key is
 * actually required - a Worker deployed without `PAIRING_SECRET`, or with the
 * check accidentally removed, would look perfectly healthy from a browser that
 * already has a key.
 *
 *   SYNC_HOSTNAME=roost.you.workers.dev pnpm verify:cloud
 */

const hostname = process.env.SYNC_HOSTNAME
if (!hostname) throw new Error('missing environment: SYNC_HOSTNAME')

const url = `https://${hostname}/api/health`

/** A hostname that does not resolve is an answer, not an error. */
async function statusOf(headers: HeadersInit = {}): Promise<number | null> {
  try {
    return (await fetch(url, { headers })).status
  } catch {
    return null
  }
}

const bare = await statusOf()
const withNonsense = await statusOf({ authorization: 'Bearer not-the-key' })

const shut = bare === 401 && withNonsense === 401
process.stdout.write(
  shut
    ? `PASS  ${hostname} refuses a request without the key\n`
    : `FAIL  ${hostname} answered ${String(bare)} with no key and ${String(withNonsense)} with a wrong one - both should be 401\n`,
)
if (!shut) process.exitCode = 1
