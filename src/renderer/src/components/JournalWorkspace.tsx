import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  LockKeyhole,
  Menu,
  Search,
  Settings,
  Trash2
} from 'lucide-react'
import type { JournalApi } from '../../../preload/index'
import {
  emptyRichTextDocument,
  richTextToPlainText,
  type RichTextDocument
} from '../../../shared/journal-contract'
import type { ApplicationView, SearchResult, UnlockedView } from '../types'
import type { AppInfo } from '../../../shared/product-info'
import { MonthCalendar } from './MonthCalendar'
import { RichTextEditor } from './RichTextEditor'
import { SettingsDialog } from './SettingsDialog'
import { HabitRecipeInvitation } from './HabitRecipeInvitation'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

interface Draft {
  date: string
  title: string
  content: RichTextDocument
}

interface JournalWorkspaceProps {
  api: JournalApi
  appInfo: AppInfo
  view: UnlockedView
  onErasureFailed(error: Error): void
  onViewChange(view: ApplicationView): void
  registerFlush(handler: () => Promise<boolean>): void
}

export function JournalWorkspace({
  api,
  appInfo,
  view,
  onErasureFailed,
  onViewChange,
  registerFlush
}: JournalWorkspaceProps): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>(view.selectedEntry ? 'saved' : 'idle')
  const [saveError, setSaveError] = useState('')
  const [celebration, setCelebration] = useState('')
  const [recipeInvitation, setRecipeInvitation] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftFromView(view))
  const draftRef = useRef(draft)
  const revisionRef = useRef(0)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushPromiseRef = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    let current = true
    if (!deferredQuery.trim()) return
    void api
      .search(deferredQuery)
      .then((value) => {
        if (current) setResults(value)
      })
      .catch((reason: Error) => {
        if (current) setSaveError(reason.message)
      })
      .finally(() => {
        if (current) setSearching(false)
      })
    return () => {
      current = false
    }
  }, [api, deferredQuery])

  const updateQuery = (value: string): void => {
    setQuery(value)
    setSearching(Boolean(value.trim()))
    if (!value.trim()) setResults([])
  }

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (flushPromiseRef.current) return flushPromiseRef.current
    if (!dirtyRef.current || !view.editable) return true

    const operation = (async (): Promise<boolean> => {
      while (dirtyRef.current) {
        const revision = revisionRef.current
        const value = structuredClone(draftRef.current)
        setSaveState('saving')
        setSaveError('')
        try {
          const result = await api.saveEntry(value)
          if (revision === revisionRef.current) dirtyRef.current = false
          onViewChange({
            ...view,
            selectedEntry: result.entry,
            entryDates: result.entryDates
          })
          if (!dirtyRef.current) setSaveState('saved')
        } catch (reason) {
          dirtyRef.current = true
          setSaveState('failed')
          setSaveError((reason as Error).message)
          return false
        }
      }
      return true
    })()
    flushPromiseRef.current = operation
    try {
      return await operation
    } finally {
      flushPromiseRef.current = null
    }
  }, [api, onViewChange, view])

  useEffect(() => {
    registerFlush(flush)
  }, [flush, registerFlush])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const updateDraft = (change: Partial<Omit<Draft, 'date'>>): void => {
    if (!view.editable) return
    const current = draftRef.current
    const next = { ...current, ...change }
    if (
      next.title === current.title &&
      JSON.stringify(next.content) === JSON.stringify(current.content)
    ) {
      return
    }
    draftRef.current = next
    setDraft(next)
    revisionRef.current += 1
    dirtyRef.current = true
    setSaveState('saving')
    setSaveError('')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), 500)
  }

  const navigate = async (date: string): Promise<void> => {
    if (!(await flush())) return
    onViewChange(await api.openDate(date))
    setResults([])
    setQuery('')
  }

  const completeToday = async (): Promise<void> => {
    if (!(await flush())) return
    try {
      const result = await api.completeToday()
      onViewChange({ ...view, selectedEntry: result.entry })
      if (result.celebrated && result.message) {
        setCelebration(result.message)
        window.setTimeout(() => setCelebration(''), 4_500)
      }
      if (result.recipePrompt === 'invite') setRecipeInvitation(true)
      if (result.recipePrompt === 'review') {
        const keep = window.confirm(
          'Is this anchor working for you? Choose OK to keep it, or Cancel to change it.'
        )
        if (!keep) setSettingsOpen(true)
      }
    } catch (reason) {
      setSaveError((reason as Error).message)
    }
  }

  const deleteEntry = async (): Promise<void> => {
    if (!view.selectedEntry) return
    if (
      !window.confirm(
        `Delete the Daily Entry for ${formatDate(view.selectedDate)}? A Device Snapshot will be created first.`
      )
    )
      return
    try {
      const result = await api.deleteEntry(view.selectedDate)
      onViewChange({ ...view, selectedEntry: null, entryDates: result.entryDates })
    } catch (reason) {
      setSaveError((reason as Error).message)
    }
  }

  const lock = async (): Promise<void> => {
    if (!(await flush())) return
    onViewChange(await api.lock())
  }

  const applyRestoredView = (restored: UnlockedView): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const nextDraft = draftFromView(restored)
    draftRef.current = nextDraft
    dirtyRef.current = false
    revisionRef.current += 1
    setDraft(nextDraft)
    setSaveState(restored.selectedEntry ? 'saved' : 'idle')
    setSaveError('')
    setResults([])
    setQuery('')
    onViewChange(restored)
  }

  const draftHasWriting = Boolean(draft.title.trim() || richTextToPlainText(draft.content))
  const isToday = view.selectedDate === view.today
  const showRecipe = isToday && !draftHasWriting && view.habitRecipe?.enabled
  const hasGap = !view.selectedEntry && view.entryDates.some((date) => date < view.today)
  const doneAvailable =
    isToday &&
    Boolean(view.selectedEntry) &&
    Boolean(
      view.selectedEntry?.title.trim() ||
      (view.selectedEntry && richTextToPlainText(view.selectedEntry.content))
    ) &&
    saveState === 'saved'

  const statusText = useMemo(() => {
    if (saveState === 'saving') return 'Saving'
    if (saveState === 'saved') return 'Saved'
    if (saveState === 'failed') return 'Save failed'
    return 'Not saved yet'
  }, [saveState])

  return (
    <main className="journal-shell">
      <a className="skip-link" href="#journal-editor">
        Skip to editor
      </a>
      <aside
        className={`journal-sidebar ${sidebarOpen ? 'journal-sidebar-open' : 'journal-sidebar-closed'}`}
        aria-label="Journal navigation"
      >
        <div className="flex items-center justify-between">
          <button
            aria-label="Open today's Daily Entry"
            className="brand-button"
            type="button"
            onClick={() => void navigate(view.today)}
          >
            {sidebarOpen ? (
              <span className="brand-wordmark">
                Ink<span>Prompts</span>
              </span>
            ) : (
              <span className="brand-monogram" aria-hidden="true">
                I<span>P</span>
              </span>
            )}
          </button>
          {sidebarOpen ? (
            <button
              aria-label="Collapse sidebar"
              className="icon-button"
              type="button"
              onClick={() => setSidebarOpen(false)}
            >
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
          ) : null}
        </div>
        {sidebarOpen ? (
          <>
            <button
              className="today-button mt-6"
              type="button"
              onClick={() => void navigate(view.today)}
            >
              <CalendarDays aria-hidden="true" size={18} /> Today
            </button>
            <label className="relative mt-4 block">
              <span className="sr-only">Search Daily Entries</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-3.5 left-3 text-[var(--text-subtle)]"
                size={17}
              />
              <input
                className="search-field"
                placeholder="Search your journal"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
              />
            </label>
            {query ? (
              <section aria-label="Search results" className="mt-3 max-h-52 overflow-y-auto">
                <p className="px-2 pb-2 text-xs text-[var(--text-subtle)]" role="status">
                  {searching
                    ? 'Searching…'
                    : `${results.length} result${results.length === 1 ? '' : 's'}`}
                </p>
                <ul className="space-y-1">
                  {results.map((result) => (
                    <li key={result.date}>
                      <button
                        className="search-result"
                        type="button"
                        onClick={() => void navigate(result.date)}
                      >
                        <span className="block text-xs text-[var(--text-subtle)]">
                          {formatDate(result.date)}
                        </span>
                        <span className="block truncate text-sm font-medium">
                          {result.title || 'Untitled'}
                        </span>
                        <span className="mt-1 block line-clamp-2 text-xs text-[var(--text-muted)]">
                          {result.snippet}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <MonthCalendar
                selectedDate={view.selectedDate}
                today={view.today}
                entryDates={view.entryDates}
                onSelect={(date) => void navigate(date)}
              />
            )}
            <div className="mt-auto space-y-1 pt-6">
              {view.pinEnabled ? (
                <button className="sidebar-action" type="button" onClick={() => void lock()}>
                  <LockKeyhole aria-hidden="true" size={18} /> Lock
                </button>
              ) : null}
              <button
                className="sidebar-action"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings aria-hidden="true" size={18} /> Settings
              </button>
            </div>
          </>
        ) : (
          <button
            aria-label="Expand sidebar"
            className="icon-button mt-6"
            type="button"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </button>
        )}
      </aside>

      <section className="journal-editor-pane" id="journal-editor">
        <div className="journal-editor-scroll">
          <article className="journal-editor-canvas">
            <section aria-label="Journal notebook" className="journal-notebook">
              <div className="journal-notebook-content">
                <header className="journal-notebook-header">
                  <div>
                    <p className="eyebrow">
                      {isToday
                        ? 'Today'
                        : view.selectedDate > view.today
                          ? 'Future date'
                          : 'Daily Entry'}
                    </p>
                    <h1 className="font-editorial journal-date-heading">
                      {formatDate(view.selectedDate)}
                    </h1>
                  </div>
                  <div className="journal-notebook-status">
                    <p
                      aria-live="polite"
                      className={`save-status save-status-${saveState}`}
                      role="status"
                    >
                      {statusText}
                    </p>
                    {view.selectedEntry && view.editable ? (
                      <button
                        aria-label={`Delete entry for ${view.selectedDate}`}
                        className="icon-button danger-icon"
                        type="button"
                        onClick={() => void deleteEntry()}
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
                    ) : null}
                  </div>
                </header>

                {!view.editable ? (
                  <p className="future-notice journal-notebook-notice">
                    Future dates are visible, but Daily Entries can only be written for today or the
                    past.
                  </p>
                ) : null}
                {view.editable && isToday && !draftHasWriting ? (
                  <div className="journal-writing-starter">
                    <p className="font-editorial">
                      {hasGap ? 'Start again with one sentence.' : view.writingStarter.question}
                    </p>
                    {showRecipe ? (
                      <p className="habit-note mt-3">{view.habitRecipe!.sentence}</p>
                    ) : null}
                  </div>
                ) : null}

                <label className="journal-title-field">
                  <span className="sr-only">Optional title</span>
                  <input
                    className="journal-title"
                    disabled={!view.editable}
                    maxLength={10_000}
                    placeholder="Optional title"
                    value={draft.title}
                    onChange={(event) => updateDraft({ title: event.target.value })}
                  />
                </label>
                <div className="editor-surface">
                  <RichTextEditor
                    content={draft.content}
                    editable={view.editable}
                    focusKey={view.selectedDate}
                    placeholder={
                      view.editable && !draftHasWriting
                        ? isToday
                          ? view.writingStarter.placeholder
                          : 'Begin writing…'
                        : undefined
                    }
                    spellcheck={view.preferences.spellcheck}
                    onChange={(content) => updateDraft({ content })}
                  />
                </div>
                {saveError ? (
                  <div className="error-banner journal-save-error" role="alert">
                    {saveError}{' '}
                    <button className="underline" type="button" onClick={() => void flush()}>
                      Try again
                    </button>
                  </div>
                ) : null}
              </div>
              <time aria-hidden="true" className="journal-page-stamp" dateTime={view.selectedDate}>
                {formatCompactDate(view.selectedDate)}
              </time>
            </section>
          </article>
        </div>

        {isToday ? (
          <footer className="journal-entry-actions">
            <div className="journal-entry-actions-inner">
              <button
                className="primary-button"
                disabled={!doneAvailable}
                type="button"
                onClick={() => void completeToday()}
              >
                Done for Today
              </button>
            </div>
          </footer>
        ) : null}
      </section>

      {celebration ? (
        <div className="celebration-toast" role="status">
          <Check aria-hidden="true" size={18} /> {celebration}
        </div>
      ) : null}
      {recipeInvitation ? (
        <HabitRecipeInvitation
          onCreate={() => {
            setRecipeInvitation(false)
            setSettingsOpen(true)
          }}
          onDismiss={() => {
            setRecipeInvitation(false)
            void api.dismissHabitRecipeInvite()
          }}
        />
      ) : null}

      <SettingsDialog
        api={api}
        appInfo={appInfo}
        flushPending={flush}
        open={settingsOpen}
        view={view}
        onClose={() => setSettingsOpen(false)}
        onErasureFailed={onErasureFailed}
        onRestore={applyRestoredView}
        onViewChange={onViewChange}
      />
    </main>
  )
}

function draftFromView(view: UnlockedView): Draft {
  return {
    date: view.selectedDate,
    title: view.selectedEntry?.title ?? '',
    content: view.selectedEntry?.content ?? emptyRichTextDocument()
  }
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function formatCompactDate(date: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
    year: '2-digit'
  }).format(new Date(`${date}T00:00:00.000Z`))
}
