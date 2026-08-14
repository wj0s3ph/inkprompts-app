import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { JournalApi } from '../../../preload/index'
import type { ApplicationView, UnlockedView } from '../types'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { ExportSettings } from './settings/ExportSettings'
import { HabitRecipeSettings } from './settings/HabitRecipeSettings'
import { PinSettings } from './settings/PinSettings'
import { RecoverySettings } from './settings/RecoverySettings'
import type { RunSettingAction } from './settings/types'
import type { AppInfo } from '../../../shared/product-info'
import { AboutSettings } from './settings/AboutSettings'
import { VaultErasureSettings } from './settings/VaultErasureSettings'
import type { ProtectPendingDraft } from '../pending-draft'

interface SettingsDialogProps {
  api: JournalApi
  appInfo: AppInfo
  open: boolean
  view: UnlockedView
  flushPending(): Promise<boolean>
  onClose(): void
  onErasureFailed(error: Error): void
  onPendingDraftReleased(): void
  onRestore(view: UnlockedView): void
  onViewChange(view: ApplicationView): void
  protectPendingDraft: ProtectPendingDraft
}

export function SettingsDialog({
  api,
  appInfo,
  open,
  view,
  flushPending,
  onClose,
  onErasureFailed,
  onPendingDraftReleased,
  onRestore,
  onViewChange,
  protectPendingDraft
}: SettingsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const run = useCallback<RunSettingAction>((name, action) => {
    setBusy(name)
    setError('')
    setMessage('')
    void action()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setBusy(''))
  }, [])

  const refresh = async (): Promise<void> => {
    onViewChange(await api.openDate(view.selectedDate))
  }

  const requireDurableDraft = async (): Promise<void> => {
    if (!(await flushPending())) {
      throw new Error('Resolve the current save error before continuing.')
    }
  }

  const common = { api, busy, run, view, refresh, showMessage: setMessage }

  return (
    <dialog
      aria-labelledby="settings-title"
      className="settings-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-5">
        <div>
          <p className="eyebrow">Journal controls</p>
          <h1 id="settings-title" className="font-editorial text-3xl tracking-[-0.035em]">
            Settings
          </h1>
        </div>
        <button aria-label="Close Settings" className="icon-button" type="button" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>

      <div className="space-y-10 p-6 sm:p-8">
        {message ? (
          <p className="status-banner" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="error-banner" ref={errorRef} role="alert" tabIndex={-1}>
            {error}
          </p>
        ) : null}

        <AppearanceSettings {...common} />
        <HabitRecipeSettings key={view.habitRecipe?.anchor ?? 'new-recipe'} {...common} />
        <PinSettings {...common} />
        <RecoverySettings
          api={api}
          onError={setError}
          onRestore={onRestore}
          onPendingDraftReleased={onPendingDraftReleased}
          open={open}
          requireDurableDraft={requireDurableDraft}
          protectPendingDraft={protectPendingDraft}
          run={run}
          showMessage={setMessage}
        />
        <ExportSettings
          api={api}
          requireDurableDraft={requireDurableDraft}
          run={run}
          showMessage={setMessage}
        />
        <VaultErasureSettings
          api={api}
          busy={busy}
          onErased={onViewChange}
          onErasureFailed={onErasureFailed}
          onPendingDraftReleased={onPendingDraftReleased}
          protectPendingDraft={protectPendingDraft}
          run={run}
          view={view}
        />
        <AboutSettings version={appInfo.version} />
      </div>
    </dialog>
  )
}
