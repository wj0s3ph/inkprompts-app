import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Feather } from 'lucide-react'
import type { JournalApi } from '../../preload/index'
import type { ApplicationView, LockedView, UnlockedView } from './types'
import type { AppInfo } from '../../shared/product-info'
import { JournalWorkspace } from './components/JournalWorkspace'
import { LockScreen } from './components/LockScreen'
import { Welcome } from './components/Welcome'

function App(): React.JSX.Element {
  const api: JournalApi | null =
    typeof window !== 'undefined' && 'journal' in window ? window.journal : null
  const [view, setView] = useState<ApplicationView | null>(null)
  const [loading, setLoading] = useState(Boolean(api))
  const [starting, setStarting] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState('')
  const [erasureFailure, setErasureFailure] = useState('')
  const flushRef = useRef<() => Promise<boolean>>(async () => true)
  const registerFlush = useCallback((handler: () => Promise<boolean>) => {
    flushRef.current = handler
  }, [])
  const updateView = useCallback((nextView: ApplicationView): void => {
    if (nextView.access === 'locked') flushRef.current = async (): Promise<boolean> => true
    setErasureFailure('')
    setView(nextView)
  }, [])

  useEffect(() => {
    if (!api) return
    let active = true
    void Promise.all([api.bootstrap(), api.getAppInfo()])
      .then(([nextView, nextAppInfo]) => {
        if (active) {
          setAppInfo(nextAppInfo)
          updateView(nextView)
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const removeLockedListener = api.onLocked((nextView) => {
      updateView(nextView as LockedView)
    })
    const removeFlushListener = api.onFlushRequested(() => flushRef.current())
    return () => {
      active = false
      removeLockedListener()
      removeFlushListener()
    }
  }, [api, updateView])

  useEffect(() => {
    if (view?.access !== 'unlocked') return
    document.documentElement.dataset.theme = view.preferences.theme
  }, [view])

  const startWriting = async (): Promise<void> => {
    if (!api) return
    setStarting(true)
    setError('')
    try {
      updateView(await api.startWriting())
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const restoreFromWelcome: JournalApi['restorePortableBackup'] = async (input) => {
    if (!api) return { status: 'cancelled' }
    const result = await api.restorePortableBackup(input)
    if (result.status === 'restored') updateView(result.view)
    return result
  }

  if (!api)
    return (
      <Welcome
        busy={false}
        onStart={() => undefined}
        onRestore={async () => ({ status: 'cancelled' })}
        openExternalPage={async () => undefined}
      />
    )

  if (loading) {
    return (
      <main className="app-state-shell">
        <div className="app-loading" role="status">
          <Feather
            aria-hidden="true"
            className="animate-pulse text-[var(--accent-text)]"
            size={30}
          />
          <div>
            <p className="brand-wordmark">
              Ink<span>Prompts</span>
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Opening your Journal Vault…</p>
          </div>
        </div>
      </main>
    )
  }

  if (error && !view) {
    return (
      <main className="app-state-shell">
        <section className="app-state-panel app-error-panel" role="alert">
          <AlertTriangle aria-hidden="true" className="text-[var(--danger)]" size={28} />
          <h1 className="font-editorial mt-5 text-3xl tracking-[-0.035em]">
            Your Journal Vault could not open
          </h1>
          <p className="mt-3 leading-7 text-[var(--text-muted)]">{error}</p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Journal content is not available in this state. Fix the reported storage problem, then
            restart InkPrompts Journal.
          </p>
        </section>
      </main>
    )
  }

  if (erasureFailure) {
    return (
      <main className="app-state-shell">
        <section className="app-state-panel app-error-panel" role="alert">
          <AlertTriangle aria-hidden="true" className="text-[var(--danger)]" size={28} />
          <h1 className="font-editorial mt-5 text-3xl tracking-[-0.035em]">
            Journal Vault Erasure needs attention
          </h1>
          <p className="mt-3 leading-7 text-[var(--text-muted)]">{erasureFailure}</p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Access to the Journal Vault is closed. Check disk access, then restart InkPrompts so it
            can safely continue the erasure.
          </p>
        </section>
      </main>
    )
  }

  if (!appInfo) {
    return (
      <main className="app-state-shell">
        <div className="app-loading" role="status">
          Loading application information…
        </div>
      </main>
    )
  }

  if (view?.access === 'locked') {
    return (
      <LockScreen
        appInfo={appInfo}
        clearForgottenPin={api.clearForgottenPin}
        onCleared={updateView}
        onRestored={updateView}
        onUnlock={api.unlock}
        onUnlocked={updateView}
        openExternalPage={api.openExternalPage}
        restorePortableBackup={api.restorePortableBackup}
      />
    )
  }

  if (!view || view.screen === 'welcome') {
    return (
      <Welcome
        busy={starting}
        onStart={() => void startWriting()}
        onRestore={restoreFromWelcome}
        openExternalPage={api.openExternalPage}
      />
    )
  }

  return (
    <JournalWorkspace
      api={api}
      appInfo={appInfo}
      key={(view as UnlockedView).selectedDate}
      onErasureFailed={(reason) => {
        flushRef.current = async (): Promise<boolean> => true
        setView(null)
        setErasureFailure(reason.message)
      }}
      registerFlush={registerFlush}
      view={view as UnlockedView}
      onViewChange={updateView}
    />
  )
}

export default App
