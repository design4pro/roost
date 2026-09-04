import { useEffect, useRef } from 'react'
import type { Selection, TreeNode } from '../state/select'
import type { TreeKey } from '../a11y/treegrid'
import { moveFocus } from '../a11y/treegrid'
import { Icon } from './Icon'
import { t } from '../i18n'

/**
 * Every device, and the windows and bookmark folders under the ones the user
 * has opened.
 *
 * An ARIA tree with roving tabindex: one stop for the whole widget, and the
 * arrow keys do the moving, which is what a screen reader user expects here
 * and what Chrome's own bookmarks manager does.
 */
const KEYS: readonly string[] = [
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
]

export function Sidebar({
  nodes,
  expanded,
  selection,
  focusIndex,
  onFocusIndex,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[]
  expanded: ReadonlySet<string>
  selection: Selection | null
  focusIndex: number
  onFocusIndex: (index: number) => void
  onToggle: (id: string) => void
  onSelect: (selection: Selection) => void
}) {
  const list = useRef<HTMLUListElement>(null)
  const shouldFocus = useRef(false)

  useEffect(() => {
    if (!shouldFocus.current) return
    shouldFocus.current = false
    const item =
      list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    item?.[focusIndex]?.focus()
  }, [focusIndex])

  const activate = (node: TreeNode) => {
    if (node.kind === 'device') return onToggle(node.id)
    return onSelect({
      deviceId: node.deviceId,
      kind: node.kind === 'window' ? 'window' : 'folder',
      id: node.id,
    })
  }

  const expandable = (node: TreeNode) =>
    node.kind === 'device' || (node.kind === 'folder' && node.expandable)

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!KEYS.includes(event.key)) return

    const move = moveFocus(
      nodes.map((node) => ({
        id: node.id,
        level: node.level,
        expandable: expandable(node),
        expanded: expanded.has(node.id),
      })),
      focusIndex,
      event.key as TreeKey,
    )
    if (move === null) return

    event.preventDefault()
    if (move.kind === 'focus') {
      shouldFocus.current = true
      onFocusIndex(move.index)
    } else {
      onToggle(move.id)
    }
  }

  return (
    <nav className="w-64 shrink-0 overflow-y-auto border-r border-divider py-2">
      <h2 className="sr-only">{t('devices_heading')}</h2>
      <ul
        ref={list}
        role="tree"
        aria-label={t('devices_heading')}
        className="m-0 list-none p-0"
        onKeyDown={onKeyDown}
      >
        {nodes.map((node, index) => (
          <li
            key={`${node.kind}:${node.id}`}
            role="treeitem"
            aria-level={node.level}
            aria-expanded={expandable(node) ? expanded.has(node.id) : undefined}
            aria-selected={node.kind !== 'device' && selection?.id === node.id}
            // The focus lives on the tree item itself rather than on a button
            // inside it: a screen reader reads the item's own role and level,
            // and a nested control would be announced instead.
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => onFocusIndex(index)}
            onClick={() => activate(node)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              activate(node)
            }}
            className="flex h-[33px] cursor-default items-center gap-2 px-3 hover:bg-hover aria-selected:bg-selected"
            style={{ paddingInlineStart: `${node.level * 15}px` }}
          >
            {node.kind === 'device' ? (
              <>
                <Icon
                  name="chevron"
                  className={`size-4 shrink-0 fill-on-surface-variant ${
                    expanded.has(node.id) ? 'rotate-90' : ''
                  }`}
                />
                <span className="truncate">{node.label}</span>
                <span className="ml-auto text-on-surface-variant">
                  {node.local
                    ? t('device_this')
                    : node.online
                      ? ''
                      : t('device_offline')}
                </span>
              </>
            ) : node.kind === 'window' ? (
              <>
                <Icon
                  name="window"
                  className="size-4 shrink-0 fill-on-surface-variant"
                />
                <span className="truncate">{node.label}</span>
                <span className="ml-auto text-on-surface-variant">
                  {node.tabCount}
                </span>
              </>
            ) : (
              <>
                <Icon
                  name="folder"
                  className="size-4 shrink-0 fill-on-surface-variant"
                />
                <span className="truncate">{node.label}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
