import type { Op } from '#/shared/protocol/ops'
import { MAX_OPS_PER_FRAME } from '#/shared/protocol/messages'
import type { Store } from '../deps'

/**
 * What this browser has to tell the hub and has not had acknowledged yet.
 *
 * The service worker is stopped whenever Chrome feels like it, so a batch is
 * written down before it is sent and only dropped once the hub has acked it.
 * That makes re-sending after a restart the normal case rather than an error
 * path; the hub already refuses to apply a batch it has seen before.
 */

const STORE_KEY = 'queue'

export interface Batch {
  clientSeq: number
  ops: Op[]
  /** The last op the hub had applied when this batch was made. */
  lastSeq: number
}

export interface QueueState {
  nextClientSeq: number
  batches: Batch[]
}

/**
 * How many unacknowledged batches are worth keeping before the queue is
 * replaced by a description of the current state. A browser that has been
 * offline for hours has no use for the history of how it got here.
 */
const COMPACT_AT = 200

export const emptyQueue = (): QueueState => ({ nextClientSeq: 1, batches: [] })

export function enqueue(
  state: QueueState,
  ops: Op[],
  lastSeq: number,
): QueueState {
  if (ops.length === 0) return state

  const batches = [...state.batches]
  let clientSeq = state.nextClientSeq
  // A frame carries a bounded number of ops, so a large flush becomes several
  // batches rather than one the hub would have to refuse.
  for (let i = 0; i < ops.length; i += MAX_OPS_PER_FRAME) {
    batches.push({
      clientSeq: clientSeq++,
      ops: ops.slice(i, i + MAX_OPS_PER_FRAME),
      lastSeq,
    })
  }
  return { nextClientSeq: clientSeq, batches }
}

/** Drop everything the hub has acknowledged up to and including `clientSeq`. */
export function ack(state: QueueState, clientSeq: number): QueueState {
  const batches = state.batches.filter((b) => b.clientSeq > clientSeq)
  return batches.length === state.batches.length ? state : { ...state, batches }
}

export const needsCompaction = (state: QueueState): boolean =>
  state.batches.length > COMPACT_AT

/**
 * Replace a long backlog with the state it was leading up to.
 *
 * Two kinds of op cannot be recovered from a snapshot and so survive
 * compaction: a window that was closed is absent from the snapshot rather than
 * deleted by it, and a command is an instruction to another device, not a fact
 * about this one.
 */
export function compact(state: QueueState, snapshot: Op[]): QueueState {
  const kept = state.batches.flatMap((batch) =>
    batch.ops.filter(
      (op) =>
        op.op === 'command' ||
        op.op === 'command_done' ||
        (op.op === 'delete' && op.entity === 'window'),
    ),
  )
  const lastSeq = state.batches.at(-1)?.lastSeq ?? 0
  return enqueue(
    { nextClientSeq: state.nextClientSeq, batches: [] },
    [...kept, ...snapshot],
    lastSeq,
  )
}

export async function loadQueue(store: Store): Promise<QueueState> {
  return (await store.get<QueueState>(STORE_KEY)) ?? emptyQueue()
}

export async function saveQueue(
  store: Store,
  state: QueueState,
): Promise<void> {
  await store.set(STORE_KEY, state)
}
