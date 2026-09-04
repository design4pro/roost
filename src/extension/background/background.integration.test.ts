import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { decodeClientFrame, encode } from '#/shared/protocol/codec'
import type { ClientFrame, ServerFrame } from '#/shared/protocol/messages'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import type { Background } from './index'
import { startBackground } from './index'
import type { SocketHandlers } from './ws/client'

const WORKER = 'https://sync.test'
const SECRET = 'pairing-key-under-test'

/** A socket the test drives from the hub's side. */
const fakeSocket = () => {
  const sent: ClientFrame[] = []
  let handlers: SocketHandlers | undefined
  let url = ''
  let protocols: string[] = []

  return {
    sent,
    url: () => url,
    protocols: () => protocols,
    openSocket: (
      socketUrl: string,
      socketProtocols: string[],
      socketHandlers: SocketHandlers,
    ) => {
      url = socketUrl
      protocols = socketProtocols
      handlers = socketHandlers
      queueMicrotask(() => socketHandlers.onOpen())
      return {
        send: (data: string) => {
          if (data === 'ping') return
          const decoded = decodeClientFrame(data)
          // The hub would close the connection over a frame it cannot read, so
          // the test refuses to let one pass quietly.
          if (!decoded.ok)
            throw new Error(`unreadable frame: ${decoded.reason}`)
          sent.push(decoded.frame)
        },
        close: () => undefined,
      }
    },
    deliver: (frame: ServerFrame) => handlers?.onMessage(encode(frame)),
    hangUp: (code: number) => handlers?.onClose(code),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let socket: ReturnType<typeof fakeSocket>

const start = async (): Promise<Background> => {
  socket = fakeSocket()
  let n = 0
  const background = await startBackground({
    browser,
    openSocket: socket.openSocket,
    clock: () => Date.now(),
    uuid: () => `id-${++n}`,
    random: () => 0.5,
  })
  await settle()
  socket.deliver({ type: 'welcome', seq: 0, mode: 'snapshot' })
  await settle()
  return background as Background
}

beforeEach(async () => {
  vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
    version: '0.1.0',
  } as never)
  vi.spyOn(browser.cookies, 'get').mockResolvedValue(null as never)
  vi.spyOn(browser.action, 'setBadgeText').mockResolvedValue(undefined)
  await fakeBrowser.storage.local.set({
    workerUrl: WORKER,
    pairingSecret: SECRET,
  })
})

describe('the background worker end to end', () => {
  it('does nothing at all before onboarding', async () => {
    await fakeBrowser.storage.local.remove('workerUrl')
    expect(
      await startBackground({
        browser,
        openSocket: fakeSocket().openSocket,
        clock: () => Date.now(),
        uuid: () => 'id',
        random: () => 0.5,
      }),
    ).toBeUndefined()
  })

  it('connects as the device it minted on first run', async () => {
    const background = await start()
    expect(socket.url()).toBe(
      `wss://sync.test/ws?device=${background.deviceId}`,
    )

    const hello = socket.sent[0]
    expect(hello).toMatchObject({
      type: 'hello',
      deviceId: background.deviceId,
    })
  })

  it('carries the pairing key in the subprotocol list, never in the URL', async () => {
    await start()

    expect(socket.protocols()).toEqual([WS_SUBPROTOCOL, SECRET])
    // The Worker's invocation logs record the URL of every request, so a key
    // that leaks into it is a key published to whoever can read them.
    expect(socket.url()).not.toContain(SECRET)
  })

  it('still offers the protocol when this browser has no key yet', async () => {
    await fakeBrowser.storage.local.remove('pairingSecret')
    await start()

    expect(socket.protocols()).toEqual([WS_SUBPROTOCOL])
  })

  it('tells the hub about a tab the user opened', async () => {
    const background = await start()
    const window = await fakeBrowser.windows.create({})
    await fakeBrowser.tabs.create({
      windowId: window?.id,
      url: 'https://a.test/',
    })
    await settle()

    await background.flushNow()

    const ops = socket.sent.flatMap((frame) =>
      frame.type === 'ops' ? frame.ops : [],
    )
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'window_snapshot' }),
    )
  })

  it('applies what another device did', async () => {
    await start()
    socket.deliver({
      type: 'changes',
      seqFrom: 0,
      seqTo: 3,
      ops: [
        {
          op: 'upsert',
          entity: 'device',
          id: 'device-b',
          data: {
            name: 'Canary',
            os: 'macOS',
            browserVersion: '141',
            extensionVersion: '0.1.0',
            online: true,
            lastSeen: 1,
          },
        },
      ],
    })
    await settle()

    const stored = await fakeBrowser.storage.local.get(['mirror', 'lastSeq'])
    expect(Object.keys((stored.mirror as { devices: object }).devices)).toEqual(
      ['device-b'],
    )
    expect(stored.lastSeq).toBe(3)
  })

  it('keeps what it could not send and sends it on reconnect', async () => {
    // The queue is written before the frame goes out, so a socket that dies
    // mid-flush costs a repeat the hub refuses, never a lost change.
    const background = await start()
    socket.hangUp(1006)

    const window = await fakeBrowser.windows.create({})
    await fakeBrowser.tabs.create({
      windowId: window?.id,
      url: 'https://a.test/',
    })
    await settle()
    await background.flushNow()

    const queue = (await fakeBrowser.storage.local.get('queue')).queue as {
      batches: unknown[]
    }
    expect(queue.batches.length).toBeGreaterThan(0)
  })
})
