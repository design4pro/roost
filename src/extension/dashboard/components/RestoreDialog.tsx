import { useEffect, useRef } from 'react'
import { t } from '../i18n'

/**
 * Confirming a restore, in a native `<dialog>`.
 *
 * `showModal()` is what gives the focus trap, the Escape handling and the
 * return of focus to the opener for free - all three are easy to get subtly
 * wrong by hand, and all three are what makes a dialog usable by keyboard.
 */
export function RestoreDialog({
  tabCount,
  onConfirm,
  onClose,
}: {
  tabCount: number
  onConfirm: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="rounded-card border-0 bg-surface p-6 text-on-surface shadow-elevation-2 backdrop:bg-black/30"
    >
      <h2 className="mt-0 text-[15px] font-medium">{t('restore_title')}</h2>
      <p className="text-on-surface-variant">
        {t('restore_body', String(tabCount))}
      </p>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="h-9 rounded-pill border border-outline bg-transparent px-6 text-on-surface"
        >
          {t('restore_cancel')}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm()
            dialog.current?.close()
          }}
          className="h-9 rounded-pill border-0 bg-primary px-6 text-on-primary"
        >
          {t('restore_confirm')}
        </button>
      </div>
    </dialog>
  )
}
