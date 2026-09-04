import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ItemRow, Row } from '../state/select'
import type { MenuItem } from './ContextMenu'
import { ContextMenu } from './ContextMenu'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { t } from '../i18n'

/**
 * The right-hand panel: one window's tabs, one folder's bookmarks, or whatever
 * a search matched - and a search matches both kinds at once, which is why they
 * share a list and a row height rather than having one each.
 *
 * Virtualised because a single window here can hold several hundred tabs, and
 * flat because a virtualiser needs rows of a known height - a group is a
 * header row rather than a wrapper. Rows carry `scroll-margin-top` so that
 * moving focus with the keyboard never parks a row under the sticky header.
 */
const ROW_HEIGHT = 48
const HEADER_HEIGHT = 48

export function TabList({
  rows,
  title,
  actions,
  headerActions = [],
}: {
  rows: Row[]
  title: string
  /** What this row can be asked to do; empty means no menu at all. */
  actions?: (row: ItemRow) => MenuItem[]
  headerActions?: MenuItem[]
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{
    items: MenuItem[]
    at: { x: number; y: number }
    opener: HTMLElement
  } | null>(null)

  const openMenu = (
    row: ItemRow,
    opener: HTMLElement,
    at: { x: number; y: number },
  ) => {
    const items = actions?.(row) ?? []
    if (items.length > 0) setMenu({ items, at, opener })
  }

  const closeMenu = () => {
    // Back where it came from: a menu that drops the focus on the body leaves
    // a keyboard user at the top of the page.
    menu?.opener.focus()
    setMenu(null)
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <div ref={viewport} className="flex-1 overflow-y-auto">
      <h2
        data-testid="panel-header"
        className="sticky top-0 z-10 m-0 flex h-12 items-center gap-3 bg-surface1 px-6 text-[14px] font-medium"
      >
        {title}
        <span className="ml-auto flex gap-2">
          {headerActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onSelect}
              className="h-9 rounded-pill border border-outline bg-transparent px-4 text-[13px] font-normal text-on-surface"
            >
              {action.label}
            </button>
          ))}
        </span>
      </h2>

      {rows.length === 0 ? (
        <p className="px-6 py-4 text-on-surface-variant">{t('no_results')}</p>
      ) : (
        <ul
          role="listbox"
          aria-label={title}
          className="relative m-0 list-none p-0"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) return null

            return (
              <li
                key={row.kind === 'group' ? `group:${row.id}` : row.id}
                role="option"
                aria-selected={false}
                className="absolute inset-x-0 top-0"
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  scrollMarginTop: `${HEADER_HEIGHT}px`,
                }}
              >
                {row.kind === 'group' ? (
                  <div className="flex h-full items-center gap-2 px-6 text-on-surface-variant">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: `var(--cr-group-${row.color})` }}
                    />
                    {row.title}
                  </div>
                ) : (
                  <div className="group flex h-full items-center pe-4">
                    <button
                      type="button"
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openMenu(row, event.currentTarget, {
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }}
                      onKeyDown={(event) => {
                        if (!event.shiftKey || event.key !== 'F10') return
                        event.preventDefault()
                        const box = event.currentTarget.getBoundingClientRect()
                        openMenu(row, event.currentTarget, {
                          x: box.left + 48,
                          y: box.bottom,
                        })
                      }}
                      className="flex h-full w-full items-center gap-3 border-0 bg-transparent px-6 text-left hover:bg-hover"
                      style={{ scrollMarginTop: `${HEADER_HEIGHT}px` }}
                    >
                      <Favicon url={row.data.url ?? ''} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-on-surface">
                          {row.data.title}
                        </span>
                        <span className="block truncate text-[12px] text-on-surface-variant">
                          {[row.context?.deviceLabel, hostOf(row.data.url)]
                            .filter((part) => part !== undefined && part !== '')
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                    {/* Always rendered, only visible on hover or focus: a
                        control that appears on hover alone cannot be reached
                        by keyboard, and one that is 32px stays big enough to
                        hit (WCAG 2.5.8). */}
                    <button
                      type="button"
                      aria-label={t('row_actions', row.data.title)}
                      onClick={(event) =>
                        openMenu(row, event.currentTarget, {
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                      className="size-8 shrink-0 rounded-full border-0 bg-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Icon
                        name="kebab"
                        className="mx-auto size-5 fill-on-surface-variant"
                      />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {menu === null ? null : (
        <ContextMenu items={menu.items} at={menu.at} onClose={closeMenu} />
      )}
    </div>
  )
}

/** A folder has no address of its own, and nothing to say on its second line. */
function hostOf(url: string | null): string {
  if (url === null) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
