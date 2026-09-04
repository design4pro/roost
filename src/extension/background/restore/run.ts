import type { browser as Chrome } from 'wxt/browser'
import type { Store } from '../deps'
import type { RestorePlan } from './plan'
import { BATCH_SIZE } from './plan'

/**
 * Carrying out a restore, in a way that survives the worker being stopped.
 *
 * Progress is written down before each batch and read back from the browser
 * rather than from a counter: the only number that cannot lie about how many
 * tabs exist is how many tabs exist. That is what makes a resume neither skip
 * a batch nor create one twice.
 */
const JOBS_KEY = 'restore.jobs'
const ACTIVE_KEY = 'restore.activeWindows'

export interface RestoreJob {
  /** The window in the mirror this one was made from. */
  sourceWindowId: string
  plan: RestorePlan
  /** Chrome's id for the window being filled in, once it exists. */
  windowId: number
}

export interface RestoreDeps {
  browser: typeof Chrome
  session: Store
  /**
   * Told as soon as the window exists, so that capture stops treating the tabs
   * this is about to create as the user's own doing.
   */
  onStarted: (windowId: number) => Promise<void>
  /** Told when a restore finishes, so its window is captured as ours. */
  onFinished: (windowId: number) => Promise<void>
}

/** Create the window and fill it in. Returns the window Chrome made. */
export async function runRestore(
  sourceWindowId: string,
  plan: RestorePlan,
  deps: RestoreDeps,
): Promise<number | undefined> {
  const created = await deps.browser.windows.create({
    url: [plan.window.url],
    ...(plan.window.state === 'normal'
      ? (plan.window.bounds ?? {})
      : { state: plan.window.state }),
  })

  const windowId = created?.id
  if (windowId === undefined) return undefined

  // Registered before the first tab is written, because from here on the
  // window's own events belong to this restore and not to the user.
  await activate(deps.session, windowId)
  await saveJob(deps.session, { sourceWindowId, plan, windowId })
  await deps.onStarted(windowId)

  if (plan.firstPinned) {
    const [first] = await deps.browser.tabs.query({ windowId, index: 0 })
    if (first?.id !== undefined) {
      await deps.browser.tabs.update(first.id, { pinned: true })
    }
  }

  await fill(windowId, plan, deps)
  return windowId
}

/** Pick up whatever a stopped service worker left half-done. */
export async function resumePending(deps: RestoreDeps): Promise<void> {
  for (const job of await jobs(deps.session)) {
    const exists = await windowExists(deps.browser, job.windowId)
    if (!exists) {
      // The user closed the window mid-restore; finishing it would put back a
      // window they just got rid of.
      await forget(deps.session, job.windowId)
      continue
    }
    await deps.onStarted(job.windowId)
    await fill(job.windowId, job.plan, deps)
  }
}

async function fill(
  windowId: number,
  plan: RestorePlan,
  deps: RestoreDeps,
): Promise<void> {
  for (const [index, batch] of plan.batches.entries()) {
    // How far this got is how many tabs the window has, which is true whether
    // or not the worker lived long enough to write anything down. The window's
    // own first tab is the `1`.
    const present = (await deps.browser.tabs.query({ windowId })).length
    const before = 1 + index * BATCH_SIZE
    // A batch interrupted halfway leaves its tail, and only its tail, to do.
    const missing = batch.slice(Math.max(0, present - before))

    for (const tab of missing) {
      await deps.browser.tabs.create({
        windowId,
        url: tab.url,
        pinned: tab.pinned,
        active: false,
      })
    }
  }

  await regroup(windowId, plan, deps)
  await forget(deps.session, windowId)
  await deps.onFinished(windowId)
}

async function regroup(
  windowId: number,
  plan: RestorePlan,
  deps: RestoreDeps,
): Promise<void> {
  if (plan.groups.length === 0) return

  const tabs = await deps.browser.tabs.query({ windowId })

  for (const group of plan.groups) {
    const ids = group.offsets
      .map((offset) => tabs[offset]?.id)
      .filter((id): id is number => id !== undefined)
    if (ids.length === 0) continue

    const [firstId, ...restIds] = ids as [number, ...number[]]
    const groupId: number = await deps.browser.tabs.group({
      tabIds: [firstId, ...restIds],
      createProperties: { windowId },
    })
    await deps.browser.tabGroups.update(groupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    })
  }
}

async function windowExists(
  browser: typeof Chrome,
  windowId: number,
): Promise<boolean> {
  try {
    await browser.windows.get(windowId)
    return true
  } catch {
    return false
  }
}

export async function activeWindows(session: Store): Promise<number[]> {
  return (await session.get<number[]>(ACTIVE_KEY)) ?? []
}

async function activate(session: Store, windowId: number): Promise<void> {
  await session.set(ACTIVE_KEY, [...(await activeWindows(session)), windowId])
}

async function jobs(session: Store): Promise<RestoreJob[]> {
  return (await session.get<RestoreJob[]>(JOBS_KEY)) ?? []
}

async function saveJob(session: Store, job: RestoreJob): Promise<void> {
  await session.set(JOBS_KEY, [...(await jobs(session)), job])
}

async function forget(session: Store, windowId: number): Promise<void> {
  await session.set(
    JOBS_KEY,
    (await jobs(session)).filter((job) => job.windowId !== windowId),
  )
  await session.set(
    ACTIVE_KEY,
    (await activeWindows(session)).filter((id) => id !== windowId),
  )
}
