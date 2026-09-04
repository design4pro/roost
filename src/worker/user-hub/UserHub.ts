import { DurableObject } from 'cloudflare:workers'
import { decodeClientFrame } from '#/shared/protocol/codec'
import {
  CLOSE_BAD_FRAME,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_QUOTA,
} from '#/shared/protocol/messages'
import type { Commands, Hello, OpsFrame } from '#/shared/protocol/messages'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import type { Op } from '#/shared/protocol/ops'
import { applyOps, currentSeq } from './apply'
import { welcomeFrames } from './delta'
import { prune } from './prune'
import { checkBudget, recordWrites } from './quota'
import { broadcast, sendFrame, sendTo } from './sockets'
import { migrate } from './schema'
import { offersSubprotocol } from '../auth/credential'
import type { Sql } from './schema'

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

/** What a socket needs to remember across a hibernation. */
interface Attachment {
  deviceId: string
  /** Whether `hello` has been received. Ops before it are a protocol error. */
  hello: boolean
}

interface HubEnv {
  WRITE_BUDGET_PER_DAY?: string
}

/**
 * One user's data and one user's sockets.
 *
 * The object hibernates between messages, so nothing may live in a field that
 * matters after a gap - the per-socket handshake state is written into the
 * socket's own attachment instead, and everything else is in SQLite.
 */
export class UserHub extends DurableObject<HubEnv> {
  private readonly sql: Sql

  constructor(ctx: DurableObjectState, env: HubEnv) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS)
      }
    })

    // Answered by the runtime without waking the object, which is what lets a
    // 20-second keepalive coexist with hibernation. The client needs that ping
    // for its own reasons: WebSocket traffic is what stops Chrome retiring the
    // extension's service worker after 30 seconds of quiet.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    )
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    const deviceId = url.searchParams.get('device')
    if (!deviceId) return new Response('missing device', { status: 400 })

    const { 0: client, 1: server } = new WebSocketPair()
    // The tag is what `getWebSockets(tag)` and `tagOf` read; the attachment
    // carries the same id so a hibernated socket can still identify itself.
    this.ctx.acceptWebSocket(server, [deviceId])
    server.serializeAttachment({ deviceId, hello: false } satisfies Attachment)

    // Echoed only when it was offered: a client that named no subprotocol
    // would refuse a 101 that answers with one. Chrome tolerates the reverse -
    // an offer we ignore - but a strict client (the e2e second device) does
    // not, which is what keeps this honest.
    return new Response(null, {
      status: 101,
      webSocket: client,
      ...(offersSubprotocol(request)
        ? { headers: { 'Sec-WebSocket-Protocol': WS_SUBPROTOCOL } }
        : {}),
    })
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return ws.close(CLOSE_BAD_FRAME, 'unknown socket')

    const decoded = decodeClientFrame(
      typeof message === 'string' ? message : undefined,
    )
    if (!decoded.ok) return ws.close(CLOSE_BAD_FRAME, decoded.reason)

    if (decoded.frame.type === 'hello') {
      return this.onHello(ws, attachment, decoded.frame)
    }

    if (!attachment.hello) {
      return ws.close(CLOSE_BAD_FRAME, 'ops before hello')
    }
    this.onOps(ws, attachment.deviceId, decoded.frame)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return

    // A browser reconnecting opens the new socket before the old one closes, so
    // presence only flips when this was the device's last socket. `ws` is still
    // in the list at this point and has to be excluded by identity.
    const remaining = this.ctx
      .getWebSockets(attachment.deviceId)
      .filter((socket) => socket !== ws)
    if (remaining.length > 0) return

    const op = this.setPresence(attachment.deviceId, false)
    if (op) this.log([op], attachment.deviceId)
  }

  override async alarm(): Promise<void> {
    prune(this.sql, Date.now())
    await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS)
  }

  private onHello(ws: WebSocket, attachment: Attachment, hello: Hello): void {
    if (hello.protocol !== PROTOCOL_VERSION) {
      return ws.close(
        CLOSE_PROTOCOL_VERSION,
        `this hub speaks protocol ${PROTOCOL_VERSION}`,
      )
    }
    // The device id is fixed when the socket is accepted, because it is what
    // the socket is tagged with. A hello claiming a different one would let a
    // device write rows it does not own.
    if (hello.deviceId !== attachment.deviceId) {
      return ws.close(CLOSE_BAD_FRAME, 'hello does not match ?device=')
    }

    ws.serializeAttachment({
      deviceId: attachment.deviceId,
      hello: true,
    } satisfies Attachment)

    const welcome = welcomeFrames(this.sql, hello.lastSeq)
    sendFrame(ws, { type: 'welcome', seq: welcome.seq, mode: welcome.mode })
    for (const frame of welcome.frames) sendFrame(ws, frame)

    const pending = this.pendingCommands(attachment.deviceId)
    if (pending.items.length > 0) sendFrame(ws, pending)

    const op = this.setPresence(attachment.deviceId, true)
    if (op) this.log([op], attachment.deviceId)
  }

  private onOps(ws: WebSocket, deviceId: string, frame: OpsFrame): void {
    const now = Date.now()
    const budget = Number(this.env.WRITE_BUDGET_PER_DAY ?? '0')
    // Four rows per op is a deliberate over-estimate: a snapshot can touch
    // several children, and refusing slightly early costs a retry while
    // refusing slightly late costs a silent, unrecoverable dropped write.
    const verdict = checkBudget(this.sql, budget, frame.ops.length * 4 + 4, now)
    if (!verdict.allowed) {
      sendFrame(ws, {
        type: 'error',
        code: 'quota',
        message: 'the daily write budget for this account is spent',
        retryAt: verdict.retryAt,
      })
      return ws.close(CLOSE_QUOTA, 'write budget exhausted')
    }

    const result = applyOps(this.sql, deviceId, frame, now)
    if (result.status === 'not_owner') {
      return sendFrame(ws, {
        type: 'error',
        code: 'not_owner',
        message: result.message,
      })
    }

    recordWrites(this.sql, result.rowsWritten, now)
    sendFrame(ws, {
      type: 'ack',
      clientSeq: frame.clientSeq,
      seq: result.seqTo,
    })

    if (result.ops.length > 0) {
      // The sender already applied these optimistically, so it is excluded -
      // otherwise every write would come back and be applied twice.
      broadcast(
        this.ctx,
        {
          type: 'changes',
          seqFrom: result.seqFrom,
          seqTo: result.seqTo,
          ops: result.ops,
        },
        deviceId,
      )
    }

    for (const delivery of result.deliveries) {
      sendTo(this.ctx, delivery.target, {
        type: 'commands',
        items: [delivery.item as Commands['items'][number]],
      })
    }
  }

  /** Commands addressed to this device that nobody has reported finishing. */
  private pendingCommands(deviceId: string): Commands {
    const rows = this.sql
      .exec<{ id: string; origin_device_id: string; body: string }>(
        `SELECT id, origin_device_id, body FROM commands
         WHERE target_device_id = ? AND done_at IS NULL ORDER BY created_at`,
        deviceId,
      )
      .toArray()
    return {
      type: 'commands',
      items: rows.map((row) => ({
        id: row.id,
        originDeviceId: row.origin_device_id,
        body: JSON.parse(row.body) as Commands['items'][number]['body'],
      })),
    }
  }

  /**
   * Flip a device's online flag, returning the op to log - or null when the
   * device has not described itself yet, in which case there is nothing worth
   * replicating.
   */
  private setPresence(deviceId: string, online: boolean): Op | null {
    const row = this.sql
      .exec<{ data: string }>('SELECT data FROM devices WHERE id = ?', deviceId)
      .toArray()[0]
    if (!row) return null

    const data = JSON.parse(row.data) as Record<string, unknown>
    if (typeof data.name !== 'string') return null
    if (data.online === online) return null

    const next = { ...data, online, lastSeen: Date.now() }
    this.sql.exec(
      'UPDATE devices SET data = ? WHERE id = ?',
      JSON.stringify(next),
      deviceId,
    )
    return { op: 'upsert', entity: 'device', id: deviceId, data: next as never }
  }

  /** Append ops to the log and tell everyone, including the device concerned. */
  private log(ops: Op[], deviceId: string): void {
    const now = Date.now()
    for (const op of ops) {
      this.sql.exec(
        'INSERT INTO changes (ts, device_id, payload) VALUES (?, ?, ?)',
        now,
        deviceId,
        JSON.stringify(op),
      )
    }
    const seqTo = currentSeq(this.sql)
    broadcast(this.ctx, {
      type: 'changes',
      seqFrom: seqTo - ops.length + 1,
      seqTo,
      ops,
    })
  }
}
