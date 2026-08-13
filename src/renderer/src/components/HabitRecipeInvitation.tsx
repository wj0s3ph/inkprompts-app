import { useEffect, useRef } from 'react'

interface HabitRecipeInvitationProps {
  onCreate(): void
  onDismiss(): void
}

export function HabitRecipeInvitation({
  onCreate,
  onDismiss
}: HabitRecipeInvitationProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog) return

    dialog.showModal()
    createButtonRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      returnFocus?.focus()
    }
  }, [])

  return (
    <dialog
      aria-describedby="recipe-invite-description"
      aria-labelledby="recipe-invite-title"
      className="prompt-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
    >
      <p className="eyebrow">Make returning easier</p>
      <h2 id="recipe-invite-title" className="font-editorial mt-2 text-2xl font-semibold">
        Connect writing to your day?
      </h2>
      <p id="recipe-invite-description" className="mt-3 leading-7 text-[var(--text-muted)]">
        Choose an Anchor Moment that already happens. InkPrompts will not schedule a notification or
        try to detect it.
      </p>
      <div className="mt-6 flex gap-3">
        <button className="primary-button" ref={createButtonRef} type="button" onClick={onCreate}>
          Create a Habit Recipe
        </button>
        <button className="text-button" type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </dialog>
  )
}
