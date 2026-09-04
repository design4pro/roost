import type { Commands } from '#/shared/protocol/messages'
import type { CommandBody, Op } from '#/shared/protocol/ops'
import type { Uuid } from '../deps'
import type { AppliedRing } from './applied-ring'

/**
 * Where a command goes.
 *
 * A row belongs to exactly one device, so closing someone else's tab is a
 * request rather than a write. If the target is this browser the work happens
 * here and nothing is sent; otherwise the command travels as an op and the
 * hub keeps it until the other device says it is done.
 */
export interface RouterDeps {
  deviceId: string
  uuid: Uuid
  ring: AppliedRing
  /** Returns whether the command was recognised and carried out. */
  execute: (body: CommandBody) => Promise<boolean>
  send: (ops: Op[]) => Promise<void>
}

export interface Router {
  dispatch: (target: string, body: CommandBody) => Promise<void>
  onIncoming: (items: Commands['items']) => Promise<void>
}

export function createRouter(deps: RouterDeps): Router {
  return {
    async dispatch(target, body) {
      if (target === deps.deviceId) {
        await deps.execute(body)
        return
      }
      await deps.send([{ op: 'command', id: deps.uuid(), target, body }])
    },

    async onIncoming(items) {
      const done: Op[] = []

      for (const item of items) {
        // Delivery is at least once: the hub holds a command until it hears
        // back, and this worker can be stopped between the two.
        if (await deps.ring.seen(item.id)) {
          done.push({ op: 'command_done', id: item.id })
          continue
        }

        if (!(await deps.execute(item.body))) continue

        await deps.ring.record(item.id)
        done.push({ op: 'command_done', id: item.id })
      }

      if (done.length > 0) await deps.send(done)
    },
  }
}
