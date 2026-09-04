import type { Changes } from '#/shared/protocol/messages'
import type { Op } from '#/shared/protocol/ops'
import { currentSeq } from './apply'
import { readMeta } from './schema'
import type { Sql } from './schema'

/**
 * How much of a welcome payload goes in one frame. The platform's ceiling is
 * 1 MiB; half of that leaves room for the JSON envelope and for one op being
 * unusually large without a retry path.
 */
const CHUNK_BYTES = 500_000

export interface Welcome {
  mode: 'delta' | 'snapshot'
  seq: number
  frames: Changes[]
}

/**
 * Everything a client is missing, as `changes` frames.
 *
 * Two ways to get there and one way to apply the result. A client whose last
 * seq is still in the log gets the ops it missed; one that fell behind further
 * than the log goes back gets the current state expressed as ops. Either way it
 * is the same frame type and the same `applyOps` on the other end, so there is
 * no second code path that could disagree about what the state is.
 */
export function welcomeFrames(sql: Sql, lastSeq: number): Welcome {
  const seq = currentSeq(sql)
  const logStartsAt = Number(readMeta(sql, 'log_starts_at') ?? '0')

  if (lastSeq >= logStartsAt && lastSeq <= seq) {
    const ops = sql
      .exec<{ seq: number; payload: string }>(
        'SELECT seq, payload FROM changes WHERE seq > ? ORDER BY seq',
        lastSeq,
      )
      .toArray()
    return {
      mode: 'delta',
      seq,
      frames: chunk(
        ops.map((row) => JSON.parse(row.payload) as Op),
        lastSeq,
        seq,
      ),
    }
  }

  return { mode: 'snapshot', seq, frames: chunk(snapshotOps(sql), 0, seq) }
}

/** The whole account, as the ops that would have produced it. */
export function snapshotOps(sql: Sql): Op[] {
  const ops: Op[] = []

  for (const row of sql
    .exec<{ id: string; data: string }>('SELECT id, data FROM devices')
    .toArray()) {
    // A device row exists as soon as one connects, before it has said anything
    // about itself; that placeholder is not worth replicating.
    const data = JSON.parse(row.data) as Record<string, unknown>
    if (typeof data.name !== 'string') continue
    ops.push({
      op: 'upsert',
      entity: 'device',
      id: row.id,
      data: data as never,
    })
  }

  const groupsByWindow = groupRows(sql, 'tab_groups')
  const tabsByWindow = groupRows(sql, 'tabs')

  for (const row of sql
    .exec<{ id: string; data: string }>('SELECT id, data FROM windows')
    .toArray()) {
    // The window comes first with no tabs, which is what clears whatever the
    // client had, and the tabs follow as ordinary upserts. Keeping them out of
    // the snapshot op is what makes chunking possible at all: a frame can be
    // split between ops but never inside one, and a window with a few thousand
    // tabs is on its own larger than a frame may be.
    ops.push({
      op: 'window_snapshot',
      id: row.id,
      data: JSON.parse(row.data) as never,
      groups: groupsByWindow.get(row.id) ?? [],
      tabs: [],
    })
    for (const tab of tabsByWindow.get(row.id) ?? []) {
      ops.push({ op: 'upsert', entity: 'tab', id: tab.id, data: tab.data })
    }
  }

  for (const row of sql
    .exec<{ id: string; data: string }>('SELECT id, data FROM bookmarks')
    .toArray()) {
    ops.push({
      op: 'upsert',
      entity: 'bookmark',
      id: row.id,
      data: JSON.parse(row.data) as never,
    })
  }

  return ops
}

function groupRows(
  sql: Sql,
  table: 'tabs' | 'tab_groups',
): Map<string, Array<{ id: string; data: never }>> {
  const byWindow = new Map<string, Array<{ id: string; data: never }>>()
  for (const row of sql
    .exec<{ id: string; window_id: string; data: string }>(
      `SELECT id, window_id, data FROM ${table}`,
    )
    .toArray()) {
    const list = byWindow.get(row.window_id) ?? []
    list.push({ id: row.id, data: JSON.parse(row.data) as never })
    byWindow.set(row.window_id, list)
  }
  return byWindow
}

function chunk(ops: Op[], seqFrom: number, seqTo: number): Changes[] {
  if (ops.length === 0) {
    return [{ type: 'changes', seqFrom, seqTo, ops: [] }]
  }

  const frames: Changes[] = []
  let batch: Op[] = []
  let bytes = 0

  for (const op of ops) {
    const size = JSON.stringify(op).length
    if (batch.length > 0 && bytes + size > CHUNK_BYTES) {
      frames.push({ type: 'changes', seqFrom, seqTo, ops: batch })
      batch = []
      bytes = 0
    }
    batch.push(op)
    bytes += size
  }
  frames.push({ type: 'changes', seqFrom, seqTo, ops: batch })
  return frames
}
