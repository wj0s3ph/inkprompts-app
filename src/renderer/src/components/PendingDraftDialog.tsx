import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface PendingDraftDialogProps {
  action: string
  concealDetails: boolean
  date: string
  trySave: (() => Promise<boolean>) | null
  onCancel(): void
  onDiscard(): void
  onSaved(): void
  pauseIdleLock(): void
  resumeIdleLock(): void
}

export function PendingDraftDialog({
  action,
  concealDetails,
  date,
  trySave,
  onCancel,
  onDiscard,
  onSaved,
  pauseIdleLock,
  resumeIdleLock
}: PendingDraftDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal()
    else dialog?.setAttribute('open', '')
    pauseIdleLock()
    const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      resumeIdleLock()
      if (dialog && typeof dialog.close === 'function') dialog.close()
      else dialog?.removeAttribute('open')
      window.setTimeout(() => {
        if (previousFocus?.isConnected) previousFocus.focus()
      }, 0)
    }
  }, [pauseIdleLock, resumeIdleLock])

  const retry = async (): Promise<void> => {
    if (!trySave) return
    setSaving(true)
    setError('')
    try {
      if (await trySave()) onSaved()
      else setError('The Pending Draft still could not be saved. It remains available.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      aria-labelledby="pending-draft-title"
      className="prompt-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="flex items-center gap-3 text-[var(--danger)]">
        <AlertTriangle aria-hidden="true" size={21} />
        <h1 id="pending-draft-title" className="font-editorial text-2xl tracking-[-0.03em]">
          Pending Draft needs a decision
        </h1>
      </div>
      <p className="mt-4 leading-7 text-[var(--text-muted)]">
        {concealDetails
          ? `There is unsaved writing behind PIN Lock. Return and unlock to save it, or discard it only if you want to ${action}.`
          : `The draft for ${formatDraftDate(date)} could not be saved. Discarding it will permanently lose that writing before you ${action}.`}
      </p>
      {error ? (
        <p className="error-banner mt-4" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          className="text-button"
          disabled={saving}
          ref={trySave ? undefined : initialFocusRef}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        {trySave ? (
          <button
            className="secondary-button"
            disabled={saving}
            ref={initialFocusRef}
            type="button"
            onClick={() => void retry()}
          >
            {saving ? 'Saving…' : 'Try again'}
          </button>
        ) : null}
        <button className="danger-button" disabled={saving} type="button" onClick={onDiscard}>
          Discard Draft and Continue
        </button>
      </div>
    </dialog>
  )
}

function formatDraftDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(year, month - 1, day))
}
