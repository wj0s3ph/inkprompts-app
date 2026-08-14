import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Feather } from 'lucide-react'
import type { JournalApi } from '../../preload/index'
import type { ApplicationView, LockedView, UnlockedView } from './types'
import type { AppInfo } from '../../shared/product-info'
import { JournalWorkspace } from './components/JournalWorkspace'
import { LockScreen } from './components/LockScreen'
import { Welcome } from './components/Welcome'
import { PendingDraftDialog } from './components/PendingDraftDialog'
import type {
  PendingDraftRequest,
  PendingDraftResolution,
  ProtectPendingDraft
} from './pending-draft'
import { useIdleLockBridge } from './useIdleLockBridge'

type LockSaveStatus = 'idle' | 'pending' | 'saved' | 'failed'

interface DraftDecision extends PendingDraftRequest {
  date: string
  resolve(resolution: PendingDraftResolution): void
}

interface FocusSnapshot {
  element: HTMLElement
  selection: { start: number; end: number } | null
}

function captureEditingFocus(): FocusSnapshot | null {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const anchor = window.getSelection()?.anchorNode
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement
  const selectedEditor = anchorElement?.closest<HTMLElement>('[aria-label="Daily Entry body"]')
  const element =
    active?.matches('.journal-title, [aria-label="Daily Entry body"]') === true
      ? active
      : selectedEditor
  if (!element) return null
  return {
    element,
    selection:
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? {
            start: element.selectionStart ?? element.value.length,
            end: element.selectionEnd ?? element.value.length
          }
        : null
  }
}

function App(): React.JSX.Element {
  const api: JournalApi | null =
    typeof window !== 'undefined' && 'journal' in window ? window.journal : null
  const [view, setView] = useState<ApplicationView | null>(null)
  const [workspaceView, setWorkspaceView] = useState<UnlockedView | null>(null)
  const [workspaceKey, setWorkspaceKey] = useState(0)
  const [loading, setLoading] = useState(Boolean(api))
  const [starting, setStarting] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState('')
  const [erasureFailure, setErasureFailure] = useState('')
  const [pendingDraft, setPendingDraft] = useState(false)
  const [quitBlocked, setQuitBlocked] = useState(false)
  const [draftDecision, setDraftDecision] = useState<DraftDecision | null>(null)
  const flushRef = useRef<() => Promise<boolean>>(async () => true)
  const discardRef = useRef<() => void>(() => undefined)
  const viewRef = useRef<ApplicationView | null>(null)
  const workspaceViewRef = useRef<UnlockedView | null>(null)
  const pendingDraftRef = useRef(false)
  const lockSaveStatusRef = useRef<LockSaveStatus>('idle')
  const lockSaveRef = useRef<Promise<boolean> | null>(null)
  const lockFocusRef = useRef<FocusSnapshot | null>(null)
  const draftDecisionRef = useRef<DraftDecision | null>(null)

  useIdleLockBridge(
    api,
    view?.access === 'unlocked'
      ? view.pinEnabled
        ? view.preferences.idleLockMinutes
        : null
      : undefined
  )

  useEffect(() => {
    if (view?.access !== 'unlocked' || !pendingDraft) return
    const frame = window.requestAnimationFrame(() => {
      const focus = lockFocusRef.current
      lockFocusRef.current = null
      const element =
        focus?.element.isConnected === true
          ? focus.element
          : document.querySelector<HTMLElement>('[aria-label="Daily Entry body"]')
      element?.focus()
      if (
        focus?.selection &&
        (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
      ) {
        element.setSelectionRange(focus.selection.start, focus.selection.end)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingDraft, view])

  const registerFlush = useCallback((handler: () => Promise<boolean>) => {
    flushRef.current = handler
  }, [])

  const registerDiscard = useCallback((handler: () => void) => {
    discardRef.current = handler
  }, [])

  const rememberWorkspace = useCallback((nextView: UnlockedView | null): void => {
    workspaceViewRef.current = nextView
    setWorkspaceView(nextView)
  }, [])

  const showView = useCallback(
    (nextView: ApplicationView): void => {
      setErasureFailure('')
      viewRef.current = nextView
      setView(nextView)
      if (nextView.access === 'unlocked') rememberWorkspace(nextView)
    },
    [rememberWorkspace]
  )

  const updateWorkspaceView = useCallback(
    (nextView: ApplicationView): void => {
      if (nextView.access === 'locked') {
        showView(nextView)
        return
      }
      setErasureFailure('')
      rememberWorkspace(nextView)
      if (viewRef.current?.access !== 'locked') {
        viewRef.current = nextView
        setView(nextView)
      }
    },
    [rememberWorkspace, showView]
  )

  const setHasPendingDraft = useCallback((value: boolean): void => {
    pendingDraftRef.current = value
    setPendingDraft(value)
  }, [])

  const releaseWorkspaceBehindLock = useCallback((): void => {
    if (viewRef.current?.access !== 'locked') return
    rememberWorkspace(null)
    flushRef.current = async (): Promise<boolean> => true
    discardRef.current = () => undefined
  }, [rememberWorkspace])

  const finishDraftDecision = useCallback((resolution: PendingDraftResolution): void => {
    const current = draftDecisionRef.current
    if (!current) return
    draftDecisionRef.current = null
    setDraftDecision(null)
    current.resolve(resolution)
  }, [])

  const protectPendingDraft = useCallback<ProtectPendingDraft>(
    async (request) => {
      const locked = viewRef.current?.access === 'locked'
      if (!locked) {
        if (await flushRef.current()) {
          setHasPendingDraft(false)
          return 'saved'
        }
        setHasPendingDraft(true)
      } else if (!pendingDraftRef.current) {
        return 'saved'
      }

      if (draftDecisionRef.current) return 'cancelled'
      return new Promise<PendingDraftResolution>((resolve) => {
        const decision: DraftDecision = {
          ...request,
          concealDetails: locked || request.concealDetails,
          date: workspaceViewRef.current?.selectedDate ?? '',
          resolve
        }
        draftDecisionRef.current = decision
        setDraftDecision(decision)
      })
    },
    [setHasPendingDraft]
  )

  const handleFlushRequested = useCallback(
    async (intent: 'close' | 'quit'): Promise<boolean> => {
      if (viewRef.current?.access === 'locked') {
        if (lockSaveRef.current) await lockSaveRef.current
        if (pendingDraftRef.current || lockSaveStatusRef.current === 'failed') {
          setQuitBlocked(true)
          return false
        }
      }
      const resolution = await protectPendingDraft({
        action: intent === 'quit' ? 'quit InkPrompts Journal' : 'close this window'
      })
      if (resolution === 'discard-authorized') {
        discardRef.current()
        setHasPendingDraft(false)
      }
      return resolution !== 'cancelled'
    },
    [protectPendingDraft, setHasPendingDraft]
  )

  const beginLockPreparation = useCallback((): void => {
    const currentWorkspace = workspaceViewRef.current
    if (!currentWorkspace || lockSaveStatusRef.current === 'pending') return
    if (currentWorkspace.pinEnabled) {
      lockFocusRef.current = captureEditingFocus()
      showView({
        access: 'locked',
        screen: 'lock',
        today: currentWorkspace.today,
        pinEnabled: true
      })
    }
    lockSaveStatusRef.current = 'pending'
    const operation = flushRef.current()
    lockSaveRef.current = operation
    void operation
      .then((success) => {
        lockSaveStatusRef.current = success ? 'saved' : 'failed'
        setHasPendingDraft(!success)
        if (success) releaseWorkspaceBehindLock()
      })
      .finally(() => {
        if (lockSaveRef.current === operation) lockSaveRef.current = null
      })
  }, [releaseWorkspaceBehindLock, setHasPendingDraft, showView])

  const handleLocked = useCallback(
    (nextView: LockedView): void => {
      setQuitBlocked(false)
      showView(nextView)
      if (lockSaveStatusRef.current === 'idle' || lockSaveStatusRef.current === 'saved') {
        releaseWorkspaceBehindLock()
      }
    },
    [releaseWorkspaceBehindLock, showView]
  )

  const unlockWithPendingDraft: JournalApi['unlock'] = useCallback(
    async (pin) => {
      if (!api) throw new Error('InkPrompts Journal is unavailable.')
      const unlocked = await api.unlock(pin)
      if (lockSaveRef.current) await lockSaveRef.current
      return lockSaveStatusRef.current === 'failed' && workspaceViewRef.current
        ? workspaceViewRef.current
        : unlocked
    },
    [api]
  )

  const completeUnlock = useCallback(
    (nextView: UnlockedView): void => {
      showView(nextView)
      if (!pendingDraftRef.current) {
        lockSaveStatusRef.current = 'idle'
        lockFocusRef.current = null
        return
      }
      window.requestAnimationFrame(() => {
        void flushRef.current().then((success) => {
          lockSaveStatusRef.current = success ? 'idle' : 'failed'
          setHasPendingDraft(!success)
        })
      })
    },
    [setHasPendingDraft, showView]
  )

  const replaceLockedState = useCallback(
    (nextView: UnlockedView): void => {
      lockSaveStatusRef.current = 'idle'
      lockSaveRef.current = null
      lockFocusRef.current = null
      setHasPendingDraft(false)
      setWorkspaceKey((value) => value + 1)
      showView(nextView)
    },
    [setHasPendingDraft, showView]
  )

  useEffect(() => {
    if (!api) return
    let active = true
    void Promise.all([api.bootstrap(), api.getAppInfo()])
      .then(([nextView, nextAppInfo]) => {
        if (active) {
          setAppInfo(nextAppInfo)
          showView(nextView)
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const removeLockedListener = api.onLocked((nextView) => {
      handleLocked(nextView as LockedView)
    })
    const removeLockRequestListener = api.onLockRequested(beginLockPreparation)
    const removeFlushListener = api.onFlushRequested(handleFlushRequested)
    return () => {
      active = false
      removeLockedListener()
      removeLockRequestListener()
      removeFlushListener()
    }
  }, [api, beginLockPreparation, handleFlushRequested, handleLocked, showView])

  useEffect(() => {
    if (view?.access !== 'unlocked') return
    document.documentElement.dataset.theme = view.preferences.theme
  }, [view])

  const startWriting = async (): Promise<void> => {
    if (!api) return
    setStarting(true)
    setError('')
    try {
      showView(await api.startWriting())
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const restoreFromWelcome: JournalApi['restorePortableBackup'] = async (input) => {
    if (!api) return { status: 'cancelled' }
    const result = await api.restorePortableBackup(input)
    if (result.status === 'restored') showView(result.view)
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

  const workspace = workspaceView ? (
    <JournalWorkspace
      key={workspaceKey}
      api={api}
      appInfo={appInfo}
      onErasureFailed={(reason) => {
        flushRef.current = async (): Promise<boolean> => true
        rememberWorkspace(null)
        setView(null)
        viewRef.current = null
        setErasureFailure(reason.message)
      }}
      onPendingDraftReleased={() => setHasPendingDraft(false)}
      onRequestLock={api.requestLock}
      registerDiscard={registerDiscard}
      registerFlush={registerFlush}
      protectPendingDraft={protectPendingDraft}
      suspended={view?.access === 'locked'}
      view={workspaceView}
      onViewChange={updateWorkspaceView}
    />
  ) : null

  if (!view || (view.access === 'unlocked' && view.screen === 'welcome')) {
    return (
      <Welcome
        busy={starting}
        onStart={() => void startWriting()}
        onRestore={restoreFromWelcome}
        openExternalPage={api.openExternalPage}
      />
    )
  }

  const locked = view.access === 'locked'
  return (
    <>
      {workspace ? (
        <div aria-hidden={locked || undefined} className="contents" hidden={locked}>
          {workspace}
        </div>
      ) : null}
      {locked ? (
        <LockScreen
          appInfo={appInfo}
          hasPendingDraft={pendingDraft}
          quitBlocked={quitBlocked}
          clearForgottenPin={api.clearForgottenPin}
          commitPortableBackupRestore={api.commitPortableBackupRestore}
          onCleared={replaceLockedState}
          onRestored={replaceLockedState}
          onErasureFailed={(reason) => {
            flushRef.current = async (): Promise<boolean> => true
            discardRef.current = () => undefined
            rememberWorkspace(null)
            setHasPendingDraft(false)
            setView(null)
            viewRef.current = null
            setErasureFailure(reason.message)
          }}
          onPendingDraftReleased={() => setHasPendingDraft(false)}
          onUnlock={unlockWithPendingDraft}
          onUnlocked={completeUnlock}
          openExternalPage={api.openExternalPage}
          preparePortableBackupRestore={api.preparePortableBackupRestore}
          protectPendingDraft={protectPendingDraft}
        />
      ) : null}
      {draftDecision ? (
        <PendingDraftDialog
          action={draftDecision.action}
          concealDetails={Boolean(draftDecision.concealDetails)}
          date={draftDecision.date}
          pauseIdleLock={() => api.pauseIdleLock('pending-draft-decision')}
          resumeIdleLock={() => api.resumeIdleLock('pending-draft-decision')}
          trySave={
            draftDecision.concealDetails
              ? null
              : async () => {
                  const saved = await flushRef.current()
                  if (saved) setHasPendingDraft(false)
                  return saved
                }
          }
          onCancel={() => finishDraftDecision('cancelled')}
          onDiscard={() => finishDraftDecision('discard-authorized')}
          onSaved={() => finishDraftDecision('saved')}
        />
      ) : null}
    </>
  )
}

export default App
