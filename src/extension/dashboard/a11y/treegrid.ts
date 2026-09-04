/**
 * Keyboard movement for the sidebar tree, following the APG treegrid pattern.
 *
 * Pure on purpose: the component owns the DOM and the virtualiser, this owns
 * the decision. A move is either a new focused index or a request to open or
 * close a node - never both, because the two are separate keystrokes to a
 * screen reader user and collapsing while moving loses their place.
 */

export interface TreeItem {
  id: string
  level: number
  /** Whether the node can hold children at all, open or not. */
  expandable: boolean
  expanded: boolean
}

export type TreeKey =
  'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End'

export type Move =
  | { kind: 'focus'; index: number }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string }

export function moveFocus(
  items: readonly TreeItem[],
  index: number,
  key: TreeKey,
): Move | null {
  const current = items[index]
  if (current === undefined)
    return items.length === 0 ? null : { kind: 'focus', index: 0 }

  switch (key) {
    case 'ArrowDown':
      return index + 1 < items.length
        ? { kind: 'focus', index: index + 1 }
        : null
    case 'ArrowUp':
      return index > 0 ? { kind: 'focus', index: index - 1 } : null
    case 'Home':
      return index === 0 ? null : { kind: 'focus', index: 0 }
    case 'End':
      return index === items.length - 1
        ? null
        : { kind: 'focus', index: items.length - 1 }
    case 'ArrowRight':
      if (!current.expandable) return null
      if (!current.expanded) return { kind: 'expand', id: current.id }
      // An open node moves onto its first child, which is the next row by
      // construction: the tree is flattened in document order.
      return index + 1 < items.length
        ? { kind: 'focus', index: index + 1 }
        : null
    case 'ArrowLeft':
      if (current.expandable && current.expanded)
        return { kind: 'collapse', id: current.id }
      return parentIndex(items, index) === null
        ? null
        : { kind: 'focus', index: parentIndex(items, index) as number }
  }
}

/** The nearest row above that sits one level shallower. */
function parentIndex(items: readonly TreeItem[], index: number): number | null {
  const level = items[index]?.level ?? 0
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = items[i]
    if (candidate !== undefined && candidate.level < level) return i
  }
  return null
}
