import type { Op } from '#/shared/protocol/ops'
import type { OpsFrame } from '#/shared/protocol/messages'
import type { Sql } from './schema'

/** Where each replicated entity lives, and what its row filters on. */
const TABLES = {
  device: 'devices',
  window: 'windows',
  tab: 'tabs',
  tab_group: 'tab_groups',
  bookmark: 'bookmarks',
} as const

export interface CommandDelivery {
  target: string
  item: { id: string; originDeviceId: string; body: unknown }
}

export type ApplyResult =
  | {
      status: 'applied' | 'duplicate'
      seqFrom: number
      seqTo: number
      ops: Op[]
      rowsWritten: number
      deliveries: CommandDelivery[]
    }
  | { status: 'not_owner'; message: string }

/**
 * Key-sorted JSON, so that "is this row different?" is a string comparison.
 *
 * The alternative - comparing the objects field by field - would need a shape
 * per entity and would drift the moment one gains a field. The alternative to
 * sorting - plain `JSON.stringify` - would call two identical rows different
 * because a client happened to build the object in another order, and every
 * such false difference is a written row charged against the day's budget.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
  return `{${entries.join(',')}}`
}

/** Runs statements and keeps the running total of rows they wrote. */
class Writer {
  rowsWritten = 0
  constructor(private readonly sql: Sql) {}

  exec(query: string, ...bindings: unknown[]): void {
    const cursor = this.sql.exec(query, ...(bindings as never[]))
    // Draining is what makes the statement run to completion, and the count is
    // only final afterwards.
    cursor.toArray()
    this.rowsWritten += cursor.rowsWritten
  }

  read<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): T[] {
    return this.sql.exec<T>(query, ...(bindings as never[])).toArray()
  }
}

const ownerOf = (w: Writer, table: string, id: string): string | null =>
  w.read<{ device_id: string }>(
    `SELECT device_id FROM ${table} WHERE id = ?`,
    id,
  )[0]?.device_id ?? null

const storedData = (w: Writer, table: string, id: string): string | null =>
  w.read<{ data: string }>(`SELECT data FROM ${table} WHERE id = ?`, id)[0]
    ?.data ?? null

/**
 * Apply one `ops` frame. Everything here runs in a single synchronous block, so
 * the Durable Object's own serialization is the transaction: no other message
 * can interleave, and `seq` comes out strictly ordered without a lock.
 */
export function applyOps(
  sql: Sql,
  deviceId: string,
  frame: OpsFrame,
  now: number,
): ApplyResult {
  const w = new Writer(sql)

  const lastClientSeq =
    w.read<{ last_client_seq: number }>(
      'SELECT last_client_seq FROM devices WHERE id = ?',
      deviceId,
    )[0]?.last_client_seq ?? 0

  // A client replays its queue after a reconnect without knowing which batches
  // landed. Re-running one would duplicate its commands, so the frame is
  // acknowledged and dropped instead.
  if (frame.clientSeq <= lastClientSeq) {
    const seq = currentSeq(sql)
    return {
      status: 'duplicate',
      seqFrom: seq,
      seqTo: seq,
      ops: [],
      rowsWritten: 0,
      deliveries: [],
    }
  }

  const logged: Op[] = []
  const deliveries: CommandDelivery[] = []

  for (const op of frame.ops) {
    const outcome = applyOne(w, deviceId, op, now, logged, deliveries)
    if (outcome) return outcome
  }

  let seqFrom = 0
  let seqTo = 0
  if (logged.length > 0) {
    for (const op of logged) {
      w.exec(
        'INSERT INTO changes (ts, device_id, payload) VALUES (?, ?, ?)',
        now,
        deviceId,
        JSON.stringify(op),
      )
    }
    seqTo = currentSeq(sql)
    seqFrom = seqTo - logged.length + 1
  }

  w.exec(
    `INSERT INTO devices (id, data, last_client_seq) VALUES (?, '{}', ?)
     ON CONFLICT (id) DO UPDATE SET last_client_seq = excluded.last_client_seq`,
    deviceId,
    frame.clientSeq,
  )

  return {
    status: 'applied',
    seqFrom,
    seqTo,
    ops: logged,
    rowsWritten: w.rowsWritten,
    deliveries,
  }
}

export function currentSeq(sql: Sql): number {
  return (
    sql
      .exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM changes')
      .toArray()[0]?.seq ?? 0
  )
}

function applyOne(
  w: Writer,
  deviceId: string,
  op: Op,
  now: number,
  logged: Op[],
  deliveries: CommandDelivery[],
): { status: 'not_owner'; message: string } | undefined {
  switch (op.op) {
    case 'upsert': {
      if (op.entity === 'device') {
        if (op.id !== deviceId) {
          return notOwner('a device may only describe itself')
        }
        // Presence is the server's to state: a device cannot vouch for its own
        // liveness, and `lastSeen` from a client clock would be a second clock
        // in a system that deliberately has one.
        const data = { ...op.data, online: true, lastSeen: now }
        if (upsertRow(w, 'devices', op.id, deviceId, data, false)) {
          logged.push({ ...op, data })
        }
        return
      }

      const table = TABLES[op.entity]
      const existing = ownerOf(w, table, op.id)
      if (existing !== null && existing !== deviceId) {
        return notOwner(`${op.entity} ${op.id} belongs to another device`)
      }
      const windowId =
        op.entity === 'tab' || op.entity === 'tab_group'
          ? op.data.windowId
          : null
      if (upsertRow(w, table, op.id, deviceId, op.data, true, windowId)) {
        logged.push(op)
      }
      return
    }

    case 'delete': {
      if (op.entity === 'device') return

      const table = TABLES[op.entity]
      const existing = ownerOf(w, table, op.id)
      if (existing === null) return // already gone; nothing to say about it
      if (existing !== deviceId) {
        return notOwner(`${op.entity} ${op.id} belongs to another device`)
      }

      if (op.entity === 'window') {
        // One statement per child table rather than one per tab: closing a
        // 200-tab window is three statements and one row in the change log,
        // and clients cascade the same way in `shared/mirror/apply.ts`.
        w.exec('DELETE FROM tabs WHERE window_id = ?', op.id)
        w.exec('DELETE FROM tab_groups WHERE window_id = ?', op.id)
      }
      w.exec(`DELETE FROM ${table} WHERE id = ?`, op.id)
      logged.push(op)
      return
    }

    case 'window_snapshot': {
      const existing = ownerOf(w, 'windows', op.id)
      if (existing !== null && existing !== deviceId) {
        return notOwner(`window ${op.id} belongs to another device`)
      }
      if (op.data.deviceId !== deviceId) {
        return notOwner('a snapshot may only describe this device')
      }

      let changed = upsertRow(w, 'windows', op.id, deviceId, op.data, true)
      changed =
        syncChildren(w, 'tab_groups', op.id, deviceId, op.groups) || changed
      changed = syncChildren(w, 'tabs', op.id, deviceId, op.tabs) || changed

      // Devices re-send a snapshot of every window on reconnect. When nothing
      // moved, that has to cost nothing at all - it is the single most common
      // write path in the system.
      if (changed) logged.push(op)
      return
    }

    case 'command': {
      w.exec(
        `INSERT INTO commands
           (id, target_device_id, origin_device_id, body, created_at, done_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO NOTHING`,
        op.id,
        op.target,
        deviceId,
        JSON.stringify(op.body),
        now,
      )
      // Commands never enter the change log. They have exactly one recipient
      // and exactly one delivery path, so putting them in a broadcast stream
      // would mean every device filtering out work meant for someone else.
      deliveries.push({
        target: op.target,
        item: { id: op.id, originDeviceId: deviceId, body: op.body },
      })
      return
    }

    case 'command_done': {
      w.exec(
        'UPDATE commands SET done_at = ? WHERE id = ? AND target_device_id = ?',
        now,
        op.id,
        deviceId,
      )
      return
    }
  }
}

const notOwner = (message: string) =>
  ({ status: 'not_owner', message }) as const

/** Writes a row only when its payload actually differs. Returns whether it did. */
function upsertRow(
  w: Writer,
  table: string,
  id: string,
  deviceId: string,
  data: unknown,
  hasDeviceColumn: boolean,
  windowId: string | null = null,
): boolean {
  const next = canonical(data)
  if (storedData(w, table, id) === next) return false

  if (windowId !== null) {
    w.exec(
      `INSERT INTO ${table} (id, device_id, window_id, data) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET window_id = excluded.window_id, data = excluded.data`,
      id,
      deviceId,
      windowId,
      next,
    )
  } else if (hasDeviceColumn) {
    w.exec(
      `INSERT INTO ${table} (id, device_id, data) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      id,
      deviceId,
      next,
    )
  } else {
    w.exec(
      `INSERT INTO ${table} (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      id,
      next,
    )
  }
  return true
}

/**
 * Make a window's children match the snapshot exactly: upsert what differs,
 * remove what the snapshot does not mention.
 */
function syncChildren(
  w: Writer,
  table: 'tabs' | 'tab_groups',
  windowId: string,
  deviceId: string,
  children: Array<{ id: string; data: unknown }>,
): boolean {
  let changed = false
  const keep = new Set(children.map((child) => child.id))

  for (const row of w.read<{ id: string }>(
    `SELECT id FROM ${table} WHERE window_id = ?`,
    windowId,
  )) {
    if (!keep.has(row.id)) {
      w.exec(`DELETE FROM ${table} WHERE id = ?`, row.id)
      changed = true
    }
  }

  for (const child of children) {
    if (upsertRow(w, table, child.id, deviceId, child.data, true, windowId)) {
      changed = true
    }
  }
  return changed
}
