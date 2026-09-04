import { useId } from 'react'
import { Icon } from './Icon'
import { t } from '../i18n'

/** The search field, and the count of what it matched. */
export function Toolbar({
  query,
  onQuery,
  resultCount,
}: {
  query: string
  onQuery: (value: string) => void
  resultCount: number
}) {
  const id = useId()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-6">
      <h1 className="m-0 text-[14px] font-medium">{t('app_name')}</h1>

      <div className="flex h-9 flex-1 items-center gap-2 rounded-pill bg-container px-4">
        <Icon
          name="search"
          className="size-4 shrink-0 fill-on-surface-variant"
        />
        <label className="sr-only" htmlFor={id}>
          {t('search_label')}
        </label>
        <input
          id={id}
          type="search"
          value={query}
          placeholder={t('search_placeholder')}
          onChange={(event) => onQuery(event.target.value)}
          className="h-9 w-full border-0 bg-transparent text-on-surface outline-none placeholder:text-on-surface-variant"
        />
      </div>

      {/* Announced, not shown: the list itself is the sighted user's count. */}
      <p role="status" aria-live="polite" className="sr-only">
        {query.trim() === '' ? '' : t('results_count', String(resultCount))}
      </p>
    </header>
  )
}
