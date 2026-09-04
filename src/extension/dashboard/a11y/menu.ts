/**
 * Keyboard behaviour of an open menu, as the APG describes it.
 *
 * Wrapping is the difference from the tree: a menu is short and circular, so
 * Down at the end goes back to the top. Escape closes and the caller puts the
 * focus back on whatever opened the menu - a rule that is easy to forget and
 * impossible to use the menu without.
 */
export type MenuKey =
  'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'Escape' | 'Enter' | ' '

export type MenuAction =
  | { kind: 'focus'; index: number }
  | { kind: 'activate'; index: number }
  | { kind: 'close' }
  | null

export function reduceMenu(
  count: number,
  index: number,
  key: MenuKey,
): MenuAction {
  if (key === 'Escape') return { kind: 'close' }
  if (key === 'Enter' || key === ' ') {
    return count === 0 ? { kind: 'close' } : { kind: 'activate', index }
  }
  if (count === 0) return null

  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: (index + 1) % count }
    case 'ArrowUp':
      return { kind: 'focus', index: (index - 1 + count) % count }
    case 'Home':
      return { kind: 'focus', index: 0 }
    case 'End':
      return { kind: 'focus', index: count - 1 }
  }
}
