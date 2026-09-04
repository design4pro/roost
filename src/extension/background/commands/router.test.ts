import { describe, expect, it, vi } from 'vitest'
import type { CommandBody, Op } from '#/shared/protocol/ops'
import { createRouter } from './router'

const setup = (options: { executes?: boolean; seen?: string[] } = {}) => {
  const sent: Op[][] = []
  const recorded: string[] = []
  const execute = vi.fn().mockResolvedValue(options.executes ?? true)

  const router = createRouter({
    deviceId: 'me',
    uuid: () => 'command-1',
    ring: {
      seen: (id) => Promise.resolve((options.seen ?? []).includes(id)),
      record: (id) => {
        recorded.push(id)
        return Promise.resolve()
      },
    },
    execute,
    send: (ops) => {
      sent.push(ops)
      return Promise.resolve()
    },
  })

  return { router, sent, recorded, execute }
}

const close: CommandBody = { kind: 'tab.close', tabId: 't1' }

describe('createRouter', () => {
  it('does the work itself when the target is this browser', async () => {
    const { router, sent, execute } = setup()
    await router.dispatch('me', close)

    expect(execute).toHaveBeenCalledWith(close)
    expect(sent).toEqual([])
  })

  it('sends a command meant for another browser', async () => {
    const { router, sent, execute } = setup()
    await router.dispatch('other', close)

    expect(execute).not.toHaveBeenCalled()
    expect(sent).toEqual([
      [{ op: 'command', id: 'command-1', target: 'other', body: close }],
    ])
  })

  it('carries out an incoming command and says it is done', async () => {
    const { router, sent, recorded, execute } = setup()
    await router.onIncoming([
      { id: 'c1', originDeviceId: 'other', body: close },
    ])

    expect(execute).toHaveBeenCalledWith(close)
    expect(recorded).toEqual(['c1'])
    expect(sent).toEqual([[{ op: 'command_done', id: 'c1' }]])
  })

  it('does a redelivered command once and answers it again', async () => {
    const { router, sent, execute } = setup({ seen: ['c1'] })
    await router.onIncoming([
      { id: 'c1', originDeviceId: 'other', body: close },
    ])

    expect(execute).not.toHaveBeenCalled()
    expect(sent).toEqual([[{ op: 'command_done', id: 'c1' }]])
  })

  it('leaves a command it does not understand for whoever does', async () => {
    const { router, sent, recorded } = setup({ executes: false })
    await router.onIncoming([
      { id: 'c1', originDeviceId: 'other', body: close },
    ])

    expect(recorded).toEqual([])
    expect(sent).toEqual([])
  })
})
