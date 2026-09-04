import { useEffect, useId, useState } from 'react'
import { browser } from 'wxt/browser'
import { probeWorker } from '../state/probe'
import { DEPLOY_URL, generateSecret } from '../pairing'
import { t } from '../i18n'

/**
 * First run: deploy a hub, then say where it is.
 *
 * Both steps are on one page and in one form, because they are one decision -
 * splitting them would leave the user holding a key with nowhere to put it.
 * The host permission is requested here rather than declared in the manifest,
 * since the address is the user's own and unknown at build time, and it has to
 * happen inside the click: Chrome refuses `permissions.request` without a user
 * gesture.
 */

/** Kept across a reload, so the key on screen stays the one already deployed. */
const DRAFT_KEY = 'pairingDraft'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const urlId = useId()
  const nameId = useId()
  const secretId = useId()
  const errorId = useId()
  const copiedId = useId()

  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [name, setName] = useState(defaultName())
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      // Re-pairing keeps the address and the name: only the key is in doubt.
      const saved = await browser.storage.local.get(['workerUrl', 'deviceName'])
      if (typeof saved.workerUrl === 'string') setUrl(saved.workerUrl)
      if (typeof saved.deviceName === 'string') setName(saved.deviceName)

      // A key generated on every render would not be the one the user has
      // already pasted into Cloudflare, so the first one is written down.
      const draft = await browser.storage.session.get(DRAFT_KEY)
      const existing = draft[DRAFT_KEY]
      if (typeof existing === 'string') return setSecret(existing)

      const minted = generateSecret()
      await browser.storage.session.set({ [DRAFT_KEY]: minted })
      setSecret(minted)
    })()
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
  }

  const connect = async () => {
    setError(null)

    let origin: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('not https')
      origin = parsed.origin
    } catch {
      setError(t('onboarding_error_url'))
      return
    }

    const granted = await browser.permissions.request({
      origins: [`${origin}/*`],
    })
    if (!granted) {
      setError(t('onboarding_error_url'))
      return
    }

    setBusy(true)
    const result = await probeWorker(origin, secret)
    setBusy(false)

    if (result !== 'ok') {
      setError(
        t(
          result === 'wrong_key'
            ? 'onboarding_error_wrong_key'
            : 'onboarding_error_unreachable',
        ),
      )
      return
    }

    await browser.storage.local.set({
      workerUrl: origin,
      pairingSecret: secret,
      deviceName: name,
    })
    await browser.storage.session.remove(DRAFT_KEY)
    onDone()
  }

  return (
    <main className="mx-auto mt-16 max-w-[480px] rounded-card bg-surface p-6 shadow-elevation-2">
      <h1 className="mt-0 text-[15px] font-medium">{t('onboarding_title')}</h1>
      <p className="text-on-surface-variant">{t('onboarding_body')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void connect()
        }}
      >
        <h2 className="mt-6 text-[13px] font-medium">
          {t('onboarding_step_deploy')}
        </h2>
        <p className="text-on-surface-variant">
          {t('onboarding_step_deploy_body')}
        </p>

        <label className="mt-4 block" htmlFor={secretId}>
          {t('onboarding_secret_label')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={secretId}
            value={secret}
            required
            spellCheck={false}
            aria-describedby={copied ? copiedId : undefined}
            onChange={(event) => {
              setSecret(event.target.value)
              setCopied(false)
            }}
            className="h-9 min-w-0 flex-1 rounded-menu border border-outline bg-surface px-3 font-mono text-on-surface"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="h-9 rounded-pill border border-outline bg-surface px-4 text-on-surface"
          >
            {t('onboarding_copy')}
          </button>
        </div>
        <p id={copiedId} role="status" className="text-on-surface-variant">
          {copied ? t('onboarding_copied') : ''}
        </p>

        <a
          href={DEPLOY_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block"
        >
          {t('onboarding_deploy_link')}
        </a>

        <h2 className="mt-6 text-[13px] font-medium">
          {t('onboarding_step_connect')}
        </h2>

        <label className="mt-4 block" htmlFor={urlId}>
          {t('onboarding_url_label')}
        </label>
        <input
          id={urlId}
          type="url"
          value={url}
          required
          aria-describedby={error === null ? undefined : errorId}
          aria-invalid={error !== null}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-1 h-9 w-full rounded-menu border border-outline bg-surface px-3 text-on-surface"
        />

        <label className="mt-4 block" htmlFor={nameId}>
          {t('onboarding_name_label')}
        </label>
        <input
          id={nameId}
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
          className="mt-1 h-9 w-full rounded-menu border border-outline bg-surface px-3 text-on-surface"
        />

        {error === null ? null : (
          <p id={errorId} role="alert" className="text-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 h-9 rounded-pill border-0 bg-primary px-6 text-on-primary"
        >
          {t('onboarding_connect')}
        </button>
      </form>
    </main>
  )
}

/**
 * Chrome does not say which channel it is, so the version is the best guess.
 *
 * `userAgentData` is Chromium-only and not in the DOM types, which is why it is
 * described here rather than imported from anywhere.
 */
interface UserAgentData {
  brands: Array<{ brand: string; version: string }>
  platform: string
}

function defaultName(): string {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData })
    .userAgentData
  const brand = data?.brands.find((entry) => !entry.brand.includes('Not'))

  return brand === undefined
    ? 'This browser'
    : `${brand.brand} ${brand.version} on ${data?.platform ?? ''}`.trim()
}
