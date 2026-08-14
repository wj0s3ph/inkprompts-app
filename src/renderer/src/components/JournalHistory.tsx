import type { JournalHistoryItem } from '../../../shared/journal-contract'

interface JournalHistoryProps {
  items: JournalHistoryItem[]
  loading: boolean
  error: string
  onSelect(date: string): void
}

interface MonthGroup {
  key: string
  label: string
  items: JournalHistoryItem[]
}

interface YearGroup {
  year: string
  months: MonthGroup[]
}

export function JournalHistory({
  items,
  loading,
  error,
  onSelect
}: JournalHistoryProps): React.JSX.Element {
  const groups = groupHistory(items)

  return (
    <section aria-label="Journal History" className="mt-3 min-h-0 flex-1 overflow-y-auto">
      {loading ? (
        <p className="px-2 py-3 text-xs text-[var(--text-subtle)]" role="status">
          Loading entries…
        </p>
      ) : null}
      {error ? (
        <p className="error-banner text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && groups.length === 0 ? (
        <p className="px-2 py-3 text-sm text-[var(--text-muted)]">No saved Daily Entries yet.</p>
      ) : null}
      <div className="space-y-5">
        {groups.map((yearGroup) => (
          <section key={yearGroup.year} aria-labelledby={`history-year-${yearGroup.year}`}>
            <h2
              className="px-2 text-xs font-semibold text-[var(--text-subtle)]"
              id={`history-year-${yearGroup.year}`}
            >
              {yearGroup.year}
            </h2>
            <div className="mt-2 space-y-4">
              {yearGroup.months.map((monthGroup) => (
                <section key={monthGroup.key} aria-labelledby={`history-month-${monthGroup.key}`}>
                  <h3 className="px-2 text-sm font-semibold" id={`history-month-${monthGroup.key}`}>
                    {monthGroup.label}
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {monthGroup.items.map((item) => (
                      <li key={item.date}>
                        <button
                          className="search-result"
                          type="button"
                          onClick={() => onSelect(item.date)}
                        >
                          <span className="block text-xs text-[var(--text-subtle)]">
                            {formatDate(item.date)}
                          </span>
                          {item.title ? (
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                          ) : null}
                          {item.empty ? (
                            <span className="mt-1 block text-xs text-[var(--text-muted)]">
                              Empty entry
                            </span>
                          ) : item.snippet ? (
                            <span className="mt-1 block line-clamp-2 text-xs text-[var(--text-muted)]">
                              {item.snippet}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function groupHistory(items: JournalHistoryItem[]): YearGroup[] {
  const years = new Map<string, Map<string, JournalHistoryItem[]>>()
  for (const item of items) {
    const year = item.date.slice(0, 4)
    const month = item.date.slice(0, 7)
    const months = years.get(year) ?? new Map<string, JournalHistoryItem[]>()
    const monthItems = months.get(month) ?? []
    monthItems.push(item)
    months.set(month, monthItems)
    years.set(year, months)
  }

  return Array.from(years, ([year, months]) => ({
    year,
    months: Array.from(months, ([key, monthItems]) => ({
      key,
      label: new Intl.DateTimeFormat('en', {
        month: 'long',
        timeZone: 'UTC'
      }).format(new Date(`${key}-01T00:00:00.000Z`)),
      items: monthItems
    }))
  }))
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`))
}
