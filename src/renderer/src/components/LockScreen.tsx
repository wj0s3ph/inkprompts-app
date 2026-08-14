import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArchiveRestore, ArrowLeft, LockKeyhole, ShieldAlert, Trash2 } from 'lucide-react'
import type { JournalApi } from '../../../preload/index'
import type { AppInfo } from '../../../shared/product-info'
import type { JournalApiError, UnlockedView } from '../types'
import { VaultErasureScopeNotice } from './VaultErasureScopeNotice'
import type { ProtectPendingDraft } from '../pending-draft'

const ERASE_CONFIRMATION = 'DELETE MY JOURNAL VAULT'

type LockScreenView = 'pin' | 'recovery' | 'restore' | 'erase'

interface LockScreenProps {
  appInfo: AppInfo
  hasPendingDraft: boolean
  quitBlocked?: boolean
  onUnlock: JournalApi['unlock']
  onUnlocked(view: UnlockedView): void
  onCleared(view: UnlockedView): void
  onRestored(view: UnlockedView): void
  onErasureFailed(error: Error): void
  onPendingDraftReleased(): void
  clearForgottenPin: JournalApi['clearForgottenPin']
  openExternalPage: JournalApi['openExternalPage']
  preparePortableBackupRestore: JournalApi['preparePortableBackupRestore']
  commitPortableBackupRestore: JournalApi['commitPortableBackupRestore']
  protectPendingDraft: ProtectPendingDraft
}

export function LockScreen({
  appInfo,
  hasPendingDraft,
  quitBlocked = false,
  onUnlock,
  onUnlocked,
  onCleared,
  onRestored,
  onErasureFailed,
  onPendingDraftReleased,
  clearForgottenPin,
  openExternalPage,
  preparePortableBackupRestore,
  commitPortableBackupRestore,
  protectPendingDraft
}: LockScreenProps): React.JSX.Element {
  const [screen, setScreen] = useState<LockScreenView>('pin')
  const [pin, setPin] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const navigate = (nextScreen: LockScreenView): void => {
    setScreen(nextScreen)
    setError('')
    setMessage('')
  }

  const submitPin = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('unlock')
    setError('')
    try {
      onUnlocked(await onUnlock(pin))
      setPin('')
    } catch (reason) {
      const journalError = reason as JournalApiError
      const delay = journalError.retryAfterMs
        ? ` Try again in ${Math.ceil(journalError.retryAfterMs / 1000)} seconds.`
        : ''
      setError(`${journalError.message}${delay}`)
    } finally {
      setBusy('')
    }
  }

  const restoreBackup = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('restore')
    setError('')
    setMessage('')
    try {
      const preparation = await preparePortableBackupRestore({ password: backupPassword })
      if (preparation.status === 'cancelled') {
        setMessage('No backup was selected. Your local Journal Vault was not changed.')
        return
      }
      const decision = await protectPendingDraft({
        action: 'restore this Portable Backup',
        concealDetails: true
      })
      if (decision === 'cancelled') {
        setMessage('Restore cancelled. The unsaved writing remains protected behind PIN Lock.')
        return
      }
      const result = await commitPortableBackupRestore(preparation.token)
      setBackupPassword('')
      onPendingDraftReleased()
      onRestored(result.view)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy('')
    }
  }

  const eraseVault = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('erase')
    setError('')
    try {
      const decision = await protectPendingDraft({
        action: 'erase the local Journal Vault',
        concealDetails: true
      })
      if (decision === 'cancelled') return
      onCleared(await clearForgottenPin(confirmation))
      onPendingDraftReleased()
      setConfirmation('')
    } catch (reason) {
      const journalError = reason as JournalApiError
      if (journalError.code === 'SAVE_FAILED') onErasureFailed(journalError)
      setError((reason as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="app-state-shell">
      <section className={`app-state-panel lock-panel ${screen === 'pin' ? '' : 'recovery-panel'}`}>
        <Brand appInfo={appInfo} openExternalPage={openExternalPage} />
        {screen === 'pin' ? (
          <PinEntry
            busy={busy === 'unlock'}
            error={error}
            errorRef={errorRef}
            pin={pin}
            onForgot={() => navigate('recovery')}
            onPinChange={setPin}
            onSubmit={submitPin}
            quitBlocked={quitBlocked}
          />
        ) : null}
        {screen === 'recovery' ? (
          <RecoveryChoices
            hasPendingDraft={hasPendingDraft}
            onBack={() => navigate('pin')}
            onErase={() => navigate('erase')}
            onRestore={() => navigate('restore')}
          />
        ) : null}
        {screen === 'restore' ? (
          <RestoreBackup
            backupPassword={backupPassword}
            busy={busy === 'restore'}
            error={error}
            errorRef={errorRef}
            message={message}
            onBack={() => navigate('recovery')}
            onPasswordChange={setBackupPassword}
            onSubmit={restoreBackup}
          />
        ) : null}
        {screen === 'erase' ? (
          <EraseVault
            busy={busy === 'erase'}
            confirmation={confirmation}
            error={error}
            errorRef={errorRef}
            onBack={() => navigate('recovery')}
            onConfirmationChange={setConfirmation}
            onSubmit={eraseVault}
          />
        ) : null}
      </section>
    </main>
  )
}

function Brand({
  appInfo,
  openExternalPage
}: {
  appInfo: AppInfo
  openExternalPage: JournalApi['openExternalPage']
}): React.JSX.Element {
  return (
    <header className="lock-brand">
      <p className="brand-wordmark" aria-label="InkPrompts">
        Ink<span>Prompts</span>
      </p>
      <div className="lock-brand-meta">
        <span>Version {appInfo.version}</span>
        <button
          className="text-button"
          type="button"
          onClick={() => void openExternalPage('privacy')}
        >
          Privacy
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void openExternalPage('support')}
        >
          Support
        </button>
      </div>
    </header>
  )
}

interface PinEntryProps {
  busy: boolean
  error: string
  errorRef: RefObject<HTMLParagraphElement | null>
  pin: string
  onForgot(): void
  onPinChange(pin: string): void
  onSubmit(event: React.FormEvent): Promise<void>
  quitBlocked: boolean
}

function PinEntry({
  busy,
  error,
  errorRef,
  pin,
  onForgot,
  onPinChange,
  onSubmit,
  quitBlocked
}: PinEntryProps): React.JSX.Element {
  return (
    <>
      <div className="lock-icon">
        <LockKeyhole aria-hidden="true" size={23} />
      </div>
      <p className="eyebrow mt-8">Private by design</p>
      <h1 className="font-editorial mt-2 text-4xl tracking-[-0.04em]">
        InkPrompts Journal is locked
      </h1>
      <p className="mt-3 leading-7 text-[var(--text-muted)]">
        Enter your 6-digit privacy PIN. Your Journal Vault remains protected by this device’s system
        key.
      </p>
      {quitBlocked ? (
        <p className="settings-warning mt-5" role="alert">
          Unlock first to save or explicitly discard the unsaved writing before quitting.
        </p>
      ) : null}
      <form className="mt-7" onSubmit={(event) => void onSubmit(event)}>
        <label className="field-label" htmlFor="unlock-pin">
          PIN
        </label>
        <input
          id="unlock-pin"
          autoFocus
          autoComplete="off"
          className="text-field tracking-[0.45em]"
          disabled={busy}
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]{6}"
          type="password"
          value={pin}
          onChange={(event) => onPinChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error ? (
          <p
            className="mt-3 text-sm text-[var(--danger)]"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}
        <button
          className="primary-button mt-6 w-full"
          disabled={busy || pin.length !== 6}
          type="submit"
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      <button className="text-button mt-5 w-full" type="button" onClick={onForgot}>
        I forgot my PIN
      </button>
    </>
  )
}

interface RecoveryChoicesProps {
  hasPendingDraft: boolean
  onBack(): void
  onErase(): void
  onRestore(): void
}

function RecoveryChoices({
  hasPendingDraft,
  onBack,
  onErase,
  onRestore
}: RecoveryChoicesProps): React.JSX.Element {
  return (
    <>
      <div className="lock-icon">
        <ShieldAlert aria-hidden="true" size={23} />
      </div>
      <p className="eyebrow mt-8">PIN recovery</p>
      <h1 className="font-editorial mt-2 text-4xl tracking-[-0.04em]">Can’t remember your PIN?</h1>
      <p className="mt-3 leading-7 text-[var(--text-muted)]">
        Your PIN cannot be recovered or reset. Restore a Portable Backup, or erase the journal data
        stored on this device and start over.
      </p>
      {hasPendingDraft ? (
        <p className="settings-warning mt-5" role="note">
          Unsaved writing is protected behind PIN Lock. Return to PIN and unlock to save it before
          using a recovery option.
        </p>
      ) : null}

      <div className="recovery-choices">
        <section className="recovery-choice" aria-labelledby="restore-choice-title">
          <div className="recovery-choice-heading">
            <ArchiveRestore aria-hidden="true" size={20} />
            <h2 id="restore-choice-title">Restore from a backup</h2>
          </div>
          <p>Use a Portable Backup file and its separate password. This is the recommended path.</p>
          <button
            autoFocus
            className="primary-button mt-4 w-full"
            type="button"
            onClick={onRestore}
          >
            Restore Portable Backup
          </button>
        </section>

        <section
          className="recovery-choice recovery-choice-danger"
          aria-labelledby="erase-choice-title"
        >
          <div className="recovery-choice-heading">
            <Trash2 aria-hidden="true" size={20} />
            <h2 id="erase-choice-title">Start over on this device</h2>
          </div>
          <p>This permanently removes the local Journal Vault and all Device Snapshots.</p>
          <button className="danger-button mt-4 w-full" type="button" onClick={onErase}>
            Erase local data and start over
          </button>
        </section>
      </div>

      <button className="text-button mt-5 w-full" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={17} />
        Back to PIN
      </button>
    </>
  )
}

interface RestoreBackupProps {
  backupPassword: string
  busy: boolean
  error: string
  errorRef: RefObject<HTMLParagraphElement | null>
  message: string
  onBack(): void
  onPasswordChange(password: string): void
  onSubmit(event: React.FormEvent): Promise<void>
}

function RestoreBackup({
  backupPassword,
  busy,
  error,
  errorRef,
  message,
  onBack,
  onPasswordChange,
  onSubmit
}: RestoreBackupProps): React.JSX.Element {
  return (
    <>
      <div className="lock-icon">
        <ArchiveRestore aria-hidden="true" size={23} />
      </div>
      <p className="eyebrow mt-8">Recommended recovery</p>
      <h1 className="font-editorial mt-2 text-4xl tracking-[-0.04em]">Restore Portable Backup</h1>
      <p className="mt-3 leading-7 text-[var(--text-muted)]">
        A valid backup replaces the current Journal Vault and its Device Snapshots. Backup files
        saved elsewhere are not changed.
      </p>
      <form className="mt-7" onSubmit={(event) => void onSubmit(event)}>
        <label className="field-label" htmlFor="recovery-backup-password">
          Backup password
        </label>
        <input
          id="recovery-backup-password"
          autoFocus
          autoComplete="off"
          className="text-field"
          disabled={busy}
          type="password"
          value={backupPassword}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        {error ? (
          <p
            className="mt-3 text-sm text-[var(--danger)]"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">
            {message}
          </p>
        ) : null}
        <button
          className="primary-button mt-6 w-full"
          disabled={busy || backupPassword.length === 0}
          type="submit"
        >
          {busy ? 'Restoring…' : 'Choose Backup and Restore'}
        </button>
      </form>
      <button className="text-button mt-5 w-full" disabled={busy} type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={17} />
        Back to recovery options
      </button>
    </>
  )
}

interface EraseVaultProps {
  busy: boolean
  confirmation: string
  error: string
  errorRef: RefObject<HTMLParagraphElement | null>
  onBack(): void
  onConfirmationChange(confirmation: string): void
  onSubmit(event: React.FormEvent): Promise<void>
}

function EraseVault({
  busy,
  confirmation,
  error,
  errorRef,
  onBack,
  onConfirmationChange,
  onSubmit
}: EraseVaultProps): React.JSX.Element {
  return (
    <>
      <div className="lock-icon recovery-danger-icon">
        <Trash2 aria-hidden="true" size={23} />
      </div>
      <p className="eyebrow mt-8 recovery-danger-text">Permanent action</p>
      <h1 className="font-editorial mt-2 text-4xl tracking-[-0.04em]">Erase local journal data?</h1>
      <VaultErasureScopeNotice className="mt-5" />
      <form className="mt-7" onSubmit={(event) => void onSubmit(event)}>
        <label className="field-label" htmlFor="erase-vault-confirmation">
          Type {ERASE_CONFIRMATION} to confirm
        </label>
        <input
          id="erase-vault-confirmation"
          autoFocus
          autoComplete="off"
          className="text-field"
          disabled={busy}
          spellCheck={false}
          type="text"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
        {error ? (
          <p
            className="mt-3 text-sm text-[var(--danger)]"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}
        <button
          className="danger-button mt-6 w-full"
          disabled={busy || confirmation !== ERASE_CONFIRMATION}
          type="submit"
        >
          {busy ? 'Erasing…' : 'Erase Journal Vault'}
        </button>
      </form>
      <button className="text-button mt-5 w-full" disabled={busy} type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={17} />
        Back to recovery options
      </button>
    </>
  )
}
