import { useEffect, useMemo, useState } from 'react'
import { browser } from 'wxt/browser'
import type { MenuItem } from './components/ContextMenu'
import { RestoreDialog } from './components/RestoreDialog'
import { Banner } from './components/Banner'
import { Onboarding } from './components/Onboarding'
import { Sidebar } from './components/Sidebar'
import { TabList } from './components/TabList'
import { Toolbar } from './components/Toolbar'
import type { ItemRow, Selection } from './state/select'
import { buildRows, buildTree } from './state/select'
import { usePort } from './state/use-port'
import { t } from './i18n'

/** The page: onboarding until there is a hub, the dashboard afterwards. */
export function App() {
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    void browser.storage.local
      .get('workerUrl')
      .then((stored) => setOnboarded(typeof stored.workerUrl === 'string'))
  }, [])

  if (onboarded === undefined) return null
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />
  return <Dashboard onRepair={() => setOnboarded(false)} />
}

function Dashboard({ onRepair }: { onRepair: () => void }) {
  const { mirror, deviceId, connection, send } = usePort()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)

  const nodes = useMemo(
    () => buildTree(mirror, deviceId, expanded),
    [mirror, deviceId, expanded],
  )
  const rows = useMemo(
    () => buildRows(mirror, selection, query),
    [mirror, selection, query],
  )

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // A device that is not connected cannot be asked to do anything: the hub
  // would hold the command until it came back, which looks like nothing
  // happening at all.
  const reachable = (id: string) => mirror.devices[id]?.online ?? false

  const copyHere = (id: string): MenuItem => ({
    label: t('menu_copy_bookmark'),
    onSelect: () => send({ type: 'copy', bookmarkId: id }),
  })

  const actions = (row: ItemRow): MenuItem[] => {
    if (row.kind === 'bookmark') {
      // Copying is this browser's own work, so it does not need the other one
      // to be awake; removing is a request to whoever owns the bookmark.
      return [
        ...(row.data.deviceId === deviceId ? [] : [copyHere(row.id)]),
        ...(reachable(row.data.deviceId)
          ? [
              {
                label: t('menu_remove_bookmark'),
                onSelect: () =>
                  send({
                    type: 'command',
                    target: row.data.deviceId,
                    body: { kind: 'bookmark.remove', bookmarkId: row.id },
                  }),
              },
            ]
          : []),
      ]
    }

    if (!reachable(row.data.deviceId)) return []
    const target = row.data.deviceId

    return [
      {
        label: t('menu_activate_tab'),
        onSelect: () =>
          send({
            type: 'command',
            target,
            body: { kind: 'tab.activate', tabId: row.id },
          }),
      },
      {
        label: t('menu_close_tab'),
        onSelect: () =>
          send({
            type: 'command',
            target,
            body: { kind: 'tab.close', tabId: row.id },
          }),
      },
    ]
  }

  const selectedWindow =
    selection === null || selection.kind === 'folder'
      ? undefined
      : mirror.windows[selection.id]

  const folderActions: MenuItem[] =
    selection === null ||
    selection.kind !== 'folder' ||
    selection.deviceId === deviceId
      ? []
      : [copyHere(selection.id)]

  const headerActions: MenuItem[] =
    selection === null || selectedWindow === undefined
      ? folderActions
      : [
          ...(selection.deviceId === deviceId
            ? []
            : [
                {
                  label: t('menu_restore_window'),
                  onSelect: () => setRestoring(selection.id),
                },
              ]),
          ...(reachable(selection.deviceId)
            ? [
                {
                  label: t('menu_close_window'),
                  onSelect: () =>
                    send({
                      type: 'command',
                      target: selection.deviceId,
                      body: { kind: 'window.close', windowId: selection.id },
                    }),
                },
              ]
            : []),
        ]

  const empty = Object.keys(mirror.tabs).length === 0

  return (
    <div className="flex h-screen flex-col">
      <Banner connection={connection} onRepair={onRepair} />
      <Toolbar query={query} onQuery={setQuery} resultCount={rows.length} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          nodes={nodes}
          expanded={expanded}
          selection={selection}
          focusIndex={focusIndex}
          onFocusIndex={setFocusIndex}
          onToggle={toggle}
          onSelect={setSelection}
        />

        {empty ? (
          <main className="flex-1 px-6 py-8">
            <h2 className="mt-0 text-[14px] font-medium">{t('empty_title')}</h2>
            <p className="text-on-surface-variant">{t('empty_body')}</p>
          </main>
        ) : (
          <TabList
            rows={rows}
            title={panelTitle(query, selection)}
            actions={actions}
            headerActions={headerActions}
          />
        )}
      </div>

      {restoring === null ? null : (
        <RestoreDialog
          tabCount={mirror.windows[restoring]?.tabOrder.length ?? 0}
          onConfirm={() => send({ type: 'restore', windowId: restoring })}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  )
}

function panelTitle(query: string, selection: Selection | null): string {
  if (query.trim() !== '') return t('search_label')
  return selection?.kind === 'folder'
    ? t('bookmarks_heading')
    : t('windows_heading')
}
