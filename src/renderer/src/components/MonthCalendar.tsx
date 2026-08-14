import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { firstDayForLocale } from '../calendar-week-start'

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
  const [monthSelection, setMonthSelection] = useState({
    selectedDate,
    visibleMonth: selectedDate.slice(0, 7)
  })
  const visibleMonth =
    monthSelection.selectedDate === selectedDate
      ? monthSelection.visibleMonth
      : selectedDate.slice(0, 7)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [dateValue, setDateValue] = useState(selectedDate)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const markedDates = useMemo(() => new Set(entryDates), [entryDates])
  const [year, month] = visibleMonth.split('-').map(Number)
  const weekStartsOn = firstDayForLocale(navigator.language)
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() - weekStartsOn + 7) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const weekdays = rotateWeekdays(weekStartsOn)
  const monthLabel = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, 1)))

  const moveMonth = (offset: number): void => {
    const next = new Date(Date.UTC(year, month - 1 + offset, 1))
    setMonthSelection({
      selectedDate,
      visibleMonth: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
    })
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (datePickerOpen && !dialog.open) dialog.showModal()
    if (!datePickerOpen && dialog.open) dialog.close()
  }, [datePickerOpen])

  const submitDate = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!dateValue) return
    setDatePickerOpen(false)
    onSelect(dateValue)
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
        aria-label="Weekdays"
        role="row"
      >
        {weekdays.map((day) => (
          <span aria-label={day.name} className="py-1" key={day.name} role="columnheader">
            {day.label}
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
      <button
        className="text-button mt-3 w-full"
        type="button"
        onClick={() => {
          setDateValue(selectedDate)
          setDatePickerOpen(true)
        }}
      >
        Go to date
      </button>
      <dialog
        aria-labelledby="go-to-date-title"
        className="prompt-dialog"
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault()
          setDatePickerOpen(false)
        }}
        onClose={() => setDatePickerOpen(false)}
      >
        <form onSubmit={submitDate}>
          <h2 className="font-editorial text-2xl" id="go-to-date-title">
            Go to date
          </h2>
          <label className="field-label mt-5" htmlFor="go-to-date-value">
            Date
          </label>
          <input
            autoFocus
            className="text-field"
            id="go-to-date-value"
            required
            type="date"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
          />
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDatePickerOpen(false)}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Open date
            </button>
          </div>
        </form>
      </dialog>
    </section>
  )
}

const weekdayNames = [
  { name: 'Sunday', label: 'Su' },
  { name: 'Monday', label: 'Mo' },
  { name: 'Tuesday', label: 'Tu' },
  { name: 'Wednesday', label: 'We' },
  { name: 'Thursday', label: 'Th' },
  { name: 'Friday', label: 'Fr' },
  { name: 'Saturday', label: 'Sa' }
] as const

function rotateWeekdays(firstDay: 0 | 1): (typeof weekdayNames)[number][] {
  return [...weekdayNames.slice(firstDay), ...weekdayNames.slice(0, firstDay)]
}
