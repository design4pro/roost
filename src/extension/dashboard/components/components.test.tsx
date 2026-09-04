import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { Banner } from './Banner'
import { RestoreDialog } from './RestoreDialog'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { TabList } from './TabList'
import type { Row, TreeNode } from '../state/select'

/**
 * The components, in a DOM.
 *
 * These check the parts a pure selector cannot: what is announced, what the
 * keyboard does, and which element the focus ends up on. `chrome.i18n` is not
 * in the fake browser, so it echoes keys back and the assertions read them.
 */
// Re-stubbed per test, because `restoreMocks` puts the original back.
beforeEach(() => {
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => key,
  )
})

// jsdom has no ResizeObserver and reports every element as zero-sized; a
// virtualiser asked to fill nothing renders nothing, so the viewport is given
// a size the way the virtualiser measures it.
globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
}

// jsdom implements <dialog> as an element but not its modal behaviour.
HTMLDialogElement.prototype.showModal = function showModal(
  this: HTMLDialogElement,
) {
  this.open = true
}
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false
  this.dispatchEvent(new Event('close'))
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { value: 600 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { value: 800 })

const tab = (id: string, title: string): Row => ({
  kind: 'tab',
  id,
  data: {
    deviceId: 'd1',
    windowId: 'w1',
    groupId: null,
    url: `https://example.com/${id}`,
    title,
    favIconUrl: '',
    pinned: false,
    discarded: false,
    active: false,
    lastAccessed: 0,
  },
})

const nodes: TreeNode[] = [
  {
    kind: 'device',
    id: 'd1',
    label: 'Chrome',
    online: true,
    local: true,
    level: 1,
  },
  {
    kind: 'window',
    id: 'w1',
    deviceId: 'd1',
    label: 'Docs',
    tabCount: 2,
    level: 2,
  },
  {
    kind: 'device',
    id: 'd2',
    label: 'Canary',
    online: false,
    local: false,
    level: 1,
  },
]

describe('Banner', () => {
  const noop = () => undefined

  it('says nothing while the connection is fine', () => {
    render(<Banner connection="online" onRepair={noop} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('explains a connection that needs the user', () => {
    render(<Banner connection="auth_required" onRepair={noop} />)
    expect(screen.getByRole('status')).toHaveTextContent('banner_auth')
  })

  it('offers the way back when the hub refused the key', () => {
    const onRepair = vi.fn()
    render(<Banner connection="auth_required" onRepair={onRepair} />)

    fireEvent.click(screen.getByRole('button', { name: 'banner_repair' }))
    expect(onRepair).toHaveBeenCalledOnce()
  })

  it('offers it for nothing else, because nothing else is the user to fix', () => {
    render(<Banner connection="offline" onRepair={noop} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says why nothing is syncing when the day budget is gone', () => {
    // The hub stops before the platform does, so this is a wait, not a fault.
    render(<Banner connection="paused_quota" onRepair={noop} />)
    expect(screen.getByRole('status')).toHaveTextContent('banner_quota')
  })
})

describe('Toolbar', () => {
  it('labels the search field and reports what was typed', () => {
    const onQuery = vi.fn()
    render(<Toolbar query="" onQuery={onQuery} resultCount={0} />)

    fireEvent.change(screen.getByLabelText('search_label'), {
      target: { value: 'docs' },
    })
    expect(onQuery).toHaveBeenCalledWith('docs')
  })

  it('announces the count only once there is a search', () => {
    const { rerender } = render(
      <Toolbar query="" onQuery={vi.fn()} resultCount={7} />,
    )
    const statuses = () =>
      screen.getAllByRole('status').map((el) => el.textContent)
    expect(statuses()).toEqual([''])

    rerender(<Toolbar query="do" onQuery={vi.fn()} resultCount={7} />)
    expect(statuses()).toEqual(['results_count'])
  })
})

describe('Sidebar', () => {
  const setup = (overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) => {
    const props = {
      nodes,
      expanded: new Set(['d1']),
      selection: null,
      focusIndex: 0,
      onFocusIndex: vi.fn(),
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      ...overrides,
    }
    render(<Sidebar {...props} />)
    return props
  }

  it('describes the tree to a screen reader', () => {
    setup()
    const items = screen.getAllByRole('treeitem')
    expect(items[0]).toHaveAttribute('aria-level', '1')
    expect(items[0]).toHaveAttribute('aria-expanded', 'true')
    expect(items[1]).toHaveAttribute('aria-level', '2')
    expect(items[2]).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a single tab stop and moves with the arrows', () => {
    const props = setup()
    const items = screen.getAllByRole('treeitem')
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])

    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })
    expect(props.onFocusIndex).toHaveBeenCalledWith(1)
  })

  it('opens a closed device rather than moving into it', () => {
    const props = setup({ focusIndex: 2 })
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowRight' })
    expect(props.onToggle).toHaveBeenCalledWith('d2')
    expect(props.onFocusIndex).not.toHaveBeenCalled()
  })

  it('selects a window when it is clicked', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('treeitem', { name: /Docs/ }))
    expect(props.onSelect).toHaveBeenCalledWith({
      deviceId: 'd1',
      kind: 'window',
      id: 'w1',
    })
  })
})

describe('TabList', () => {
  it('shows the rows it is given, under a sticky header', () => {
    render(
      <TabList
        rows={[tab('t1', 'First'), tab('t2', 'Second')]}
        title="Windows"
      />,
    )

    const list = screen.getByRole('listbox', { name: 'Windows' })
    expect(within(list).getByText('First')).toBeDefined()
    expect(screen.getByTestId('panel-header')).toHaveTextContent('Windows')
  })

  it('keeps a focused row clear of the header', () => {
    render(<TabList rows={[tab('t1', 'First')]} title="Windows" />)
    const row = screen.getAllByRole('option')[0] as HTMLElement
    expect(row.style.scrollMarginTop).toBe('48px')
  })

  it('says so when a search matched nothing', () => {
    render(<TabList rows={[]} title="Windows" />)
    expect(screen.getByText('no_results')).toBeDefined()
  })
})

describe('TabList menus', () => {
  const actions = (onSelect: () => void) => () => [
    { label: 'menu_close_tab', onSelect },
  ]

  it('offers a row menu from the keyboard and puts the focus back', () => {
    render(
      <TabList
        rows={[tab('t1', 'First')]}
        title="Windows"
        actions={actions(vi.fn())}
      />,
    )

    const row = screen.getByRole('button', { name: /First/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })

    const item = screen.getByRole('menuitem', { name: 'menu_close_tab' })
    expect(item).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row).toHaveFocus()
  })

  it('runs what the menu item says', () => {
    const onSelect = vi.fn()
    render(
      <TabList
        rows={[tab('t1', 'First')]}
        title="Windows"
        actions={actions(onSelect)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'row_actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu_close_tab' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('has no menu for a row with nothing to offer', () => {
    render(
      <TabList
        rows={[tab('t1', 'First')]}
        title="Windows"
        actions={() => []}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'row_actions' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the actions the whole window has', () => {
    const onSelect = vi.fn()
    render(
      <TabList
        rows={[tab('t1', 'First')]}
        title="Windows"
        headerActions={[{ label: 'menu_restore_window', onSelect }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'menu_restore_window' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('RestoreDialog', () => {
  it('asks before opening thirty tabs', () => {
    const onConfirm = vi.fn()
    render(
      <RestoreDialog tabCount={30} onConfirm={onConfirm} onClose={vi.fn()} />,
    )

    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'restore_confirm' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('closes without restoring anything', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <RestoreDialog tabCount={30} onConfirm={onConfirm} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'restore_cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
