import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface MonthCalendarProps {
  selectedDate: string
  today: string
  entryDates: string[]
  onSelect(date: string): void
}

export function MonthCalendar({
  selectedDate,
  today,
  entryDates,
  onSelect
}: MonthCalendarProps): React.JSX.Element {
  const [visibleMonth, setVisibleMonth] = useState(selectedDate.slice(0, 7))
  const markedDates = useMemo(() => new Set(entryDates), [entryDates])
  const [year, month] = visibleMonth.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthLabel = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, 1)))

  const moveMonth = (offset: number): void => {
    const next = new Date(Date.UTC(year, month - 1 + offset, 1))
    setVisibleMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <section aria-label="Journal calendar" className="mt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{monthLabel}</h2>
        <div className="flex gap-1">
          <button
            className="icon-button"
            aria-label="Previous month"
            type="button"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            type="button"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <div
        className="mt-3 grid grid-cols-7 text-center text-[11px] font-semibold text-[var(--text-subtle)]"
        aria-hidden="true"
      >
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <span key={`${day}-${index}`} className="py-1">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstWeekday }).map((_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = `${visibleMonth}-${String(index + 1).padStart(2, '0')}`
          const selected = date === selectedDate
          const isToday = date === today
          return (
            <button
              key={date}
              aria-current={selected ? 'date' : undefined}
              aria-label={new Intl.DateTimeFormat('en', {
                dateStyle: 'full',
                timeZone: 'UTC'
              }).format(new Date(`${date}T00:00:00.000Z`))}
              className={`calendar-day ${selected ? 'calendar-day-selected' : ''}`}
              type="button"
              onClick={() => onSelect(date)}
            >
              <span className={isToday ? 'font-bold' : undefined}>{index + 1}</span>
              {markedDates.has(date) ? (
                <span aria-label="Has Daily Entry" className="entry-dot" />
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
