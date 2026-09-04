import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { browser } from 'wxt/browser'
import { Onboarding } from './Onboarding'
import * as probe from '../state/probe'

/**
 * The first screen, which is the only one that can leave the user stuck.
 *
 * `t()` is not mocked here: the tests assert on labels and roles the way a
 * screen reader would reach them, and the fake i18n returns the key itself.
 */

const HUB = 'https://roost.example.workers.dev'

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'onboarding_connect' }))

/**
 * The generated key arrives a tick after the first render, and the field is
 * `required` - so submitting before it lands is the browser refusing the form,
 * not the code under test refusing anything.
 */
const mintedKey = async (): Promise<string> => {
  const field: HTMLInputElement = await screen.findByLabelText(
    'onboarding_secret_label',
  )
  await waitFor(() => expect(field.value).not.toBe(''))
  return field.value
}

// Re-stubbed per test, because `restoreMocks` puts the original back.
beforeEach(() => {
  fakeBrowser.reset()
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => key,
  )
  // The fake types this as returning nothing; the real one answers with
  // whether the user said yes, which is what the component branches on.
  vi.spyOn(browser.permissions, 'request').mockResolvedValue(true as never)
})

describe('Onboarding', () => {
  it('offers a key of its own so the user never has to invent one', async () => {
    render(<Onboarding onDone={() => undefined} />)

    expect(await mintedKey()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('keeps the same key across a reload of the page', async () => {
    const first = render(<Onboarding onDone={() => undefined} />)
    const minted = await mintedKey()
    first.unmount()

    // Cloudflare already has this key by now; generating another one here
    // would pair the browser with a hub that has never heard of it.
    render(<Onboarding onDone={() => undefined} />)
    expect(await mintedKey()).toBe(minted)
  })

  it('stores the address, the key and the name once the hub accepts them', async () => {
    vi.spyOn(probe, 'probeWorker').mockResolvedValue('ok')
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)

    const minted = await mintedKey()

    fill('onboarding_url_label', `${HUB}/`)
    fill('onboarding_name_label', 'Canary')
    submit()

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(await fakeBrowser.storage.local.get(null)).toMatchObject({
      workerUrl: HUB,
      deviceName: 'Canary',
      pairingSecret: minted,
    })
  })

  it('tells a refused key apart from an address that answers nothing', async () => {
    const probing = vi
      .spyOn(probe, 'probeWorker')
      .mockResolvedValue('wrong_key')
    render(<Onboarding onDone={() => undefined} />)
    await mintedKey()

    fill('onboarding_url_label', HUB)
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'onboarding_error_wrong_key',
    )

    probing.mockResolvedValue('unreachable')
    submit()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'onboarding_error_unreachable',
      ),
    )
  })

  it('refuses an address that is not https before asking for anything', async () => {
    // Cleared rather than merely created: spying on a module export keeps one
    // spy for the file, so its history outlives the test that made it.
    const probing = vi.spyOn(probe, 'probeWorker')
    probing.mockClear()
    render(<Onboarding onDone={() => undefined} />)
    await mintedKey()

    fill('onboarding_url_label', 'http://roost.example.workers.dev')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'onboarding_error_url',
    )
    expect(probing).not.toHaveBeenCalled()
  })
})
