import { describe, expect, it } from 'vitest'
import type { Op, WindowData } from '#/shared/protocol/ops'
import {
  CLOSE_BAD_FRAME,
  CLOSE_PROTOCOL_VERSION,
} from '#/shared/protocol/messages'
import { connect } from '../test/client'
import { freshHub } from '../test/hub'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const windowData = (deviceId: string, tabOrder: string[]): WindowData => ({
  deviceId,
  state: 'normal',
  bounds: null,
  focused: true,
  tabOrder,
})

const openWindow = (deviceId: string, windowId: string): Op => ({
  op: 'window_snapshot',
  id: windowId,
  data: windowData(deviceId, ['t1']),
  groups: [],
  tabs: [
    {
      id: 't1',
      data: {
        deviceId,
        windowId,
        groupId: null,
        url: 'https://example.test/',
        title: 'Example',
        favIconUrl: null,
        pinned: false,
        discarded: false,
        active: true,
        lastAccessed: 1,
      },
    },
  ],
})

describe('UserHub', () => {
  it('welcomes a new client with an empty delta', async () => {
    const client = await connect(freshHub(), A)
    client.hello()

    const welcome = await client.next('welcome')
    expect(welcome).toMatchObject({ seq: 0, mode: 'delta' })
    // Even an empty welcome is followed by a changes frame, so the client has
    // exactly one place where "the handshake is done" is decided.
    expect((await client.next('changes')).ops).toEqual([])
  })

  it('acks the sender and tells everyone else', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    const b = await connect(hub, B)
    a.hello()
    b.hello()
    await Promise.all([a.next('welcome'), b.next('welcome')])

    a.send({ type: 'ops', clientSeq: 1, ops: [openWindow(A, 'w1')] })

    expect(await a.next('ack')).toMatchObject({ clientSeq: 1 })
    const changes = await b.next('changes', (frame) => frame.ops.length > 0)
    expect(changes.ops[0]).toMatchObject({ op: 'window_snapshot', id: 'w1' })
  })

  it('does not echo a device its own writes', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    a.hello()
    await a.next('welcome')
    await a.next('changes')

    a.send({ type: 'ops', clientSeq: 1, ops: [openWindow(A, 'w1')] })
    await a.next('ack')

    // The sender applied the op optimistically before sending it. Getting it
    // back would be a second apply of the same change.
    const b = await connect(hub, B)
    b.hello()
    await b.next('changes', (frame) => frame.ops.length > 0)
    await expect(
      Promise.race([
        a.next('changes'),
        new Promise((resolve) => setTimeout(() => resolve('nothing'), 50)),
      ]),
    ).resolves.toBe('nothing')
  })

  it('replays only what a reconnecting client missed', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    a.hello()
    await a.next('welcome')
    a.send({ type: 'ops', clientSeq: 1, ops: [openWindow(A, 'w1')] })
    const ack = await a.next('ack')

    const again = await connect(hub, B)
    again.hello({ lastSeq: ack.seq })
    expect(await again.next('welcome')).toMatchObject({ mode: 'delta' })
    expect((await again.next('changes')).ops).toEqual([])
  })

  it('rejects ops sent before hello', async () => {
    const client = await connect(freshHub(), A)
    client.send({ type: 'ops', clientSeq: 1, ops: [] })
    expect(await client.closed()).toMatchObject({ code: CLOSE_BAD_FRAME })
  })

  it('rejects a hello that claims another device', async () => {
    // The socket is tagged with the id from ?device=, and that tag is what
    // routes commands and scopes ownership. A hello naming a different device
    // would be a way to write rows this socket does not own.
    const client = await connect(freshHub(), A)
    client.hello({ deviceId: B })
    expect(await client.closed()).toMatchObject({ code: CLOSE_BAD_FRAME })
  })

  it('rejects a client speaking another protocol version', async () => {
    const client = await connect(freshHub(), A)
    client.hello({ protocol: 99 })
    expect(await client.closed()).toMatchObject({
      code: CLOSE_PROTOCOL_VERSION,
    })
  })

  it('rejects a frame that is not the protocol', async () => {
    const client = await connect(freshHub(), A)
    client.socket.send('{"type":"nonsense"}')
    expect(await client.closed()).toMatchObject({ code: CLOSE_BAD_FRAME })
  })

  it('delivers a command to its target and nobody else', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    const b = await connect(hub, B)
    a.hello()
    b.hello()
    await Promise.all([a.next('welcome'), b.next('welcome')])

    a.send({
      type: 'ops',
      clientSeq: 1,
      ops: [
        {
          op: 'command',
          id: 'c1',
          target: B,
          body: { kind: 'tab.close', tabId: 't1' },
        },
      ],
    })

    const commands = await b.next('commands')
    expect(commands.items).toEqual([
      { id: 'c1', originDeviceId: A, body: { kind: 'tab.close', tabId: 't1' } },
    ])
  })

  it('holds a command until its target connects', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    a.hello()
    await a.next('welcome')
    a.send({
      type: 'ops',
      clientSeq: 1,
      ops: [
        {
          op: 'command',
          id: 'c1',
          target: B,
          body: { kind: 'window.close', windowId: 'w1' },
        },
      ],
    })
    await a.next('ack')

    const b = await connect(hub, B)
    b.hello()
    expect((await b.next('commands')).items).toHaveLength(1)
  })

  it('tells the others when a device goes offline', async () => {
    const hub = freshHub()
    const a = await connect(hub, A)
    const b = await connect(hub, B)
    a.hello()
    b.hello()
    await Promise.all([a.next('welcome'), b.next('welcome')])

    a.send({
      type: 'ops',
      clientSeq: 1,
      ops: [
        {
          op: 'upsert',
          entity: 'device',
          id: A,
          data: {
            name: 'Canary',
            os: 'macOS',
            browserVersion: '141',
            extensionVersion: '0.1.0',
            online: true,
            lastSeen: 0,
          },
        },
      ],
    })
    await b.next('changes', (frame) =>
      frame.ops.some((op) => op.op === 'upsert' && op.entity === 'device'),
    )

    a.socket.close(1000, 'done')

    const offline = await b.next('changes', (frame) =>
      frame.ops.some(
        (op) => op.op === 'upsert' && op.entity === 'device' && !op.data.online,
      ),
    )
    expect(offline.ops[0]).toMatchObject({ entity: 'device', id: A })
  })
})
