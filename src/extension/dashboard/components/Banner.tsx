import type { ConnectionStatus } from '#/extension/port/protocol'
import { t } from '../i18n'

/**
 * One line about the connection, and only when there is something to say.
 *
 * `role="status"` rather than an alert: a connection that drops and returns is
 * ordinary, and interrupting a screen reader every time would be worse than
 * saying nothing.
 */
const MESSAGES: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'banner_connecting',
  offline: 'banner_offline',
  auth_required: 'banner_auth',
  paused_quota: 'banner_quota',
  incompatible: 'banner_incompatible',
}

export function Banner({
  connection,
  onRepair,
}: {
  connection: ConnectionStatus
  /** Offered only for a refused key, which is the one state the user can fix. */
  onRepair: () => void
}) {
  const key = MESSAGES[connection]

  return (
    <div role="status" aria-live="polite">
      {key === undefined ? null : (
        <p className="m-0 flex items-center gap-3 border-b border-divider bg-container px-6 py-2 text-on-surface-variant">
          {t(key)}
          {connection === 'auth_required' ? (
            <button
              type="button"
              onClick={onRepair}
              className="h-9 rounded-pill border border-outline bg-surface px-4 text-on-surface"
            >
              {t('banner_repair')}
            </button>
          ) : null}
        </p>
      )}
    </div>
  )
}
