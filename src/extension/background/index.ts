import type { browser as Chrome } from 'wxt/browser'
import type { Mirror } from '#/shared/mirror/types'
import type { Op } from '#/shared/protocol/ops'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import type { Hello } from '#/shared/protocol/messages'
import type { Clock, Random, Store, Uuid } from './deps'
import { createStore } from './storage'
import { createIdMap } from './ids/id-map'
import { createMirrorStore } from './mirror/store'
import type { OpenSocket } from './ws/client'
import { createClient, RETRY_ALARM, WATCHDOG_ALARM } from './ws/client'
import type { CaptureContext, DirtyKey } from './capture/dirty'
import { eventToDirty } from './capture/dirty'
import { subscribe } from './capture/events'
import { flush } from './capture/flush'
import type { ConnectionStatus, DashboardMessage } from '../port/protocol'
import { createPortHub } from './port'
import { createAppliedRing } from './commands/applied-ring'
import { createRouter } from './commands/router'
import { executeTabCommand } from './commands/tab-executor'
import { executeBookmarkCommand } from './bookmarks/executor'
import { subtreeToCopy } from './bookmarks/mirror'
import { flushBookmarks } from './bookmarks/flush'
import { planRestore } from './restore/plan'
import { activeWindows, resumePending, runRestore } from './restore/run'
import { openDashboard } from './open-dashboard'
import type { WsState } from './ws/state-machine'
import type { Coalescer } from './coalescer'
import { emptyCoalescer, mark, tick } from './coalescer'

/**
 * Wiring, and only wiring.
 *
 * Every decision this file appears to make has already been made by a pure
 * function somewhere below it. What is left is the order things happen in, the
 * timers, and which storage area each piece of state belongs to.
 */

const DIRTY_KEY = 'dirtyKeys'

export interface BackgroundDeps {
  browser: typeof Chrome
  openSocket: OpenSocket
  clock: Clock
  uuid: Uuid
  random: Random
}

export interface Background {
  /** The device this browser is, minted on first run. */
  deviceId: string
  /** Read the browser for everything outstanding and tell the hub. */
  flushNow: () => Promise<void>
  client: ReturnType<typeof createClient>
}

export async function startBackground(
  deps: BackgroundDeps,
): Promise<Background | undefined> {
  const local = createStore(deps.browser.storage.local)
  const session = createStore(deps.browser.storage.session)

  const workerUrl = await local.get<string>('workerUrl')
  // Until onboarding has run there is no hub to talk to, and capturing changes
  // nobody will ever read would only waste the user's storage.
  if (workerUrl === undefined) return undefined

  const deviceId = await identify(local, deps.uuid)
  const ids = createIdMap(session, deps.uuid)
  const mirror = createMirrorStore(local)

  const client = createClient({
    browser: deps.browser,
    store: local,
    mirror,
    openSocket: deps.openSocket,
    clock: deps.clock,
    random: deps.random,
    workerUrl,
    deviceId,
    secret: () => local.get<string>('pairingSecret'),
    hello: () => hello(deviceId, local, mirror, deps),
    snapshotAll: () => snapshotAll(deps, ids, deviceId),
    onCommands: (items) => void router.onIncoming(items),
    onApplied: (ops) => hub.broadcast(ops),
    requestLogin: () => void badge(true),
  })

  const router = createRouter({
    deviceId,
    uuid: deps.uuid,
    ring: createAppliedRing(local),
    execute: async (body) =>
      (await executeTabCommand(body, { browser: deps.browser, ids })) ||
      (await executeBookmarkCommand(body, { browser: deps.browser })),
    send: (ops) => client.send(ops),
  })

  const restore = {
    browser: deps.browser,
    session,
    onStarted: async () => {
      // Read back from storage rather than appended in memory: a resume after
      // the worker was stopped starts from what is written down.
      context = { ...context, restoreActive: await activeWindows(session) }
    },
    onFinished: async (windowId: number) => {
      // The restored window is this browser's own from here on, so it is
      // captured the same way any other window would be.
      context = { ...context, restoreActive: await activeWindows(session) }
      await remember(session, [`window:${windowId}`])
      await flushNow()
    },
  }

  const hub = createPortHub({
    browser: deps.browser,
    mirror,
    deviceId,
    connection: () => statusOf(client.state()),
    onMessage: (message) => onDashboardMessage(message),
  })

  const onDashboardMessage = async (message: DashboardMessage) => {
    if (message.type === 'command') {
      await router.dispatch(message.target, message.body)
      return
    }

    const { mirror: current } = await mirror.read()

    if (message.type === 'copy') {
      const parentId = barOf(current, deviceId)
      const nodes = subtreeToCopy(current, message.bookmarkId)
      if (parentId === undefined || nodes.length === 0) return
      await router.dispatch(deviceId, {
        kind: 'bookmark.copy',
        parentId,
        nodes,
      })
      return
    }

    const window = current.windows[message.windowId]
    if (window === undefined) return

    const plan = planRestore(
      window,
      window.tabOrder.flatMap((id) => {
        const tab = current.tabs[id]
        return tab === undefined ? [] : [tab]
      }),
      current.tabGroups,
      deps.browser.runtime.getURL('/lazy.html'),
    )
    if (plan === null) return

    await runRestore(message.windowId, plan, restore)
  }

  /**
   * The toolbar's only job here: say that the hub is refusing this browser's
   * key. What to do about it is the dashboard's banner, and re-pairing there
   * is what clears this again.
   */
  const badge = (shown: boolean) =>
    deps.browser.action.setBadgeText({ text: shown ? '!' : '' })

  let coalescer: Coalescer = emptyCoalescer()
  let timer: ReturnType<typeof setTimeout> | undefined
  let context: CaptureContext = { restoreActive: [], bookmarksPaused: false }

  const flushNow = async () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined

    const keys = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
    if (keys.length === 0) return

    // Cleared before the read, not after: a key that produces no op is a key
    // whose event has already been overtaken, and re-reading it would only ever
    // produce the same nothing.
    await session.set(DIRTY_KEY, [])
    const ops = [
      ...(await flush(keys, { browser: deps.browser, ids, deviceId })),
      ...(await flushBookmarks(keys, {
        browser: deps.browser,
        deviceId,
        // Positions already reported are what a folder is diffed against, so
        // a bookmark nobody moved keeps the key it has and writes no row.
        positions: positionsOf(await mirror.read(), deviceId),
      })),
    ]
    if (ops.length === 0) return

    // Our own changes are applied here as well: the hub does not send a device
    // its own ops back, so this is what keeps the local mirror complete.
    await mirror.apply(ops)
    hub.broadcast(ops)
    await client.send(ops)
  }

  const schedule = (at: number) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void onTick(), Math.max(0, at - deps.clock()))
  }

  const onTick = async () => {
    const [next, result] = tick(coalescer, deps.clock())
    coalescer = next
    if (result.flush) await flushNow()
    else if (result.nextDeadline !== undefined) schedule(result.nextDeadline)
  }

  subscribe(deps.browser, (event) => {
    if (event.type === 'bookmarks.import.began') {
      context = { ...context, bookmarksPaused: true }
    }
    if (event.type === 'bookmarks.import.ended') {
      context = { ...context, bookmarksPaused: false }
    }
    if (event.type === 'tab.replaced') {
      void ids.remap('tab', event.removedTabId, event.addedTabId)
    }

    const keys = eventToDirty(event, context)
    if (keys.length === 0) return
    void remember(session, keys).then(() => {
      const now = deps.clock()
      for (const key of keys) coalescer = mark(coalescer, key, now)
      return onTick()
    })
  })

  deps.browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG_ALARM || alarm.name === RETRY_ALARM) {
      void client.handleAlarm(alarm.name).then(() => hub.announce())
    }
  })

  deps.browser.action.onClicked.addListener(
    () => void openDashboard(deps.browser),
  )

  // A key pasted into the dashboard lands in storage, not here: this is what
  // turns that write into another connection attempt without a restart.
  deps.browser.storage.local.onChanged.addListener((changes) => {
    if (!('pairingSecret' in changes)) return
    void badge(false).then(() => client.authenticated())
  })

  deps.browser.runtime.onMessage.addListener((message: unknown) => {
    // The placeholder page cannot navigate itself to a `file:` URL.
    const request = message as { type?: string; url?: string }
    if (request.type !== 'lazy.open-file' || request.url === undefined) return
    void openLocalFile(deps.browser, request.url)
  })

  // The bookmark tree is sent whole once and then only in the parts that
  // change; an import replaces so much of it that it is sent whole again.
  if ((await local.get<number>('bookmarksSyncedAt')) === undefined) {
    await remember(session, ['bookmarks'])
    await local.set('bookmarksSyncedAt', deps.clock())
  }

  // Whatever the worker was killed in the middle of is still written down.
  context = { ...context, restoreActive: await activeWindows(session) }
  await resumePending(restore)
  await flushNow()
  await client.start()
  hub.announce()

  return { deviceId, flushNow, client }
}

/**
 * A restored tab whose address is a local file. Chrome refuses this from the
 * page itself, and refuses it here too unless the user has ticked "Allow access
 * to file URLs" for the extension.
 */
async function openLocalFile(
  browser: typeof Chrome,
  url: string,
): Promise<void> {
  if (!(await browser.extension.isAllowedFileSchemeAccess())) return

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id !== undefined) await browser.tabs.update(tab.id, { url })
}

/** The connection as the dashboard needs to describe it. */
function statusOf(state: WsState): ConnectionStatus {
  switch (state.kind) {
    case 'open':
      return 'online'
    case 'auth_required':
      return 'auth_required'
    case 'paused_quota':
      return 'paused_quota'
    case 'incompatible':
      return 'incompatible'
    case 'connecting':
    case 'handshaking':
      return 'connecting'
    default:
      return 'offline'
  }
}

/** Where a copy lands: this browser's own bookmarks bar. */
function barOf(mirror: Mirror, deviceId: string): string | undefined {
  const found = Object.entries(mirror.bookmarks).find(
    ([, bookmark]) =>
      bookmark.deviceId === deviceId && bookmark.rootKind === 'bookmarks-bar',
  )
  return found?.[0]
}

/** What this device has told the hub about where its bookmarks sit. */
function positionsOf(
  snapshot: { mirror: Mirror },
  deviceId: string,
): Record<string, string> {
  const positions: Record<string, string> = {}
  for (const [id, bookmark] of Object.entries(snapshot.mirror.bookmarks)) {
    if (bookmark.deviceId === deviceId) positions[id] = bookmark.position
  }
  return positions
}

async function identify(local: Store, uuid: Uuid): Promise<string> {
  const existing = await local.get<string>('deviceId')
  if (existing !== undefined) return existing

  const minted = uuid()
  await local.set('deviceId', minted)
  return minted
}

async function remember(session: Store, keys: DirtyKey[]): Promise<void> {
  const current = (await session.get<DirtyKey[]>(DIRTY_KEY)) ?? []
  // Written down before anything is done about them: the service worker can be
  // stopped between the event and the flush, and an event is not repeated.
  await session.set(DIRTY_KEY, [...new Set([...current, ...keys])])
}

async function hello(
  deviceId: string,
  local: Store,
  mirror: ReturnType<typeof createMirrorStore>,
  deps: BackgroundDeps,
): Promise<Hello> {
  const { lastSeq } = await mirror.read()
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    deviceId,
    name: (await local.get<string>('deviceName')) ?? 'This browser',
    os: navigator.platform,
    browserVersion: navigator.userAgent,
    extensionVersion: deps.browser.runtime.getManifest().version,
    lastSeq,
    lastClientSeq: 0,
  }
}

/** Every window this browser has open, as the ops that would produce them. */
async function snapshotAll(
  deps: BackgroundDeps,
  ids: ReturnType<typeof createIdMap>,
  deviceId: string,
): Promise<Op[]> {
  const windows = await deps.browser.windows.getAll()
  const keys = windows
    .filter((window) => window.id !== undefined)
    .map((window) => `window:${window.id}`)
  return flush(keys, { browser: deps.browser, ids, deviceId })
}
