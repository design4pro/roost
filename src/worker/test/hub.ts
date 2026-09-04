import { env, runInDurableObject } from 'cloudflare:test'
import type { Op } from '#/shared/protocol/ops'
import type { UserHub } from '../user-hub/UserHub'
import { applyOps } from '../user-hub/apply'

/**
 * A Durable Object nobody else in this run will touch.
 *
 * The Workers pool normally isolates storage per test file, but that resets the
 * object between a socket being accepted and a message arriving on it, so this
 * project runs without isolation (see vitest.config.ts). Naming each object
 * after a fresh UUID gives back the isolation that matters.
 */
export const freshHub = (): DurableObjectStub<UserHub> =>
  env.USER_HUB.getByName(crypto.randomUUID())

export const withSql = <T>(
  stub: DurableObjectStub<UserHub>,
  fn: (sql: SqlStorage) => T,
): Promise<T> =>
  runInDurableObject(stub, (_instance, state) => fn(state.storage.sql))

/**
 * Apply ops the way a client would: one frame, one device, an increasing
 * `clientSeq`. Returns what `applyOps` said about the batch.
 */
export function apply(
  sql: SqlStorage,
  deviceId: string,
  ops: Op[],
  options: { clientSeq?: number; now?: number } = {},
) {
  return applyOps(
    sql,
    deviceId,
    {
      type: 'ops',
      clientSeq: options.clientSeq ?? nextClientSeq(deviceId),
      ops,
    },
    options.now ?? 1_700_000_000_000,
  )
}

const counters = new Map<string, number>()
function nextClientSeq(deviceId: string): number {
  const next = (counters.get(deviceId) ?? 0) + 1
  counters.set(deviceId, next)
  return next
}
