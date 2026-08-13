import { ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { JournalApi } from '../../../../preload/index'
import type { JournalApiError, UnlockedView } from '../../types'
import { VaultErasureScopeNotice } from '../VaultErasureScopeNotice'
import type { RunSettingAction } from './types'

interface VaultErasureSettingsProps {
  api: JournalApi
  busy: string
  view: UnlockedView
  run: RunSettingAction
  flushPending(): Promise<boolean>
  onErased(view: Awaited<ReturnType<JournalApi['eraseJournalVault']>>): void
  onErasureFailed(error: Error): void
}

export function VaultErasureSettings({
  api,
  busy,
  view,
  run,
  flushPending,
  onErased,
  onErasureFailed
}: VaultErasureSettingsProps): React.JSX.Element {
  const [mode, setMode] = useState<'backup' | 'skip'>('backup')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pin, setPin] = useState('')
  const [eraseConfirmation, setEraseConfirmation] = useState('')
  const [unsavedConfirmed, setUnsavedConfirmed] = useState(false)

  const erase = (): void => {
    run('erase-vault', async () => {
      if (mode === 'backup') {
        if (!(await flushPending())) {
          throw new Error('Resolve the current save error before creating the safety backup.')
        }
        const result = await api.createPortableBackup({ password, confirmation })
        if (result.status !== 'saved') {
          throw new Error('Journal Vault Erasure was cancelled because no backup was saved.')
        }
      }
      let erased: Awaited<ReturnType<JournalApi['eraseJournalVault']>>
      try {
        erased = await api.eraseJournalVault({
          confirmation: eraseConfirmation,
          ...(view.pinEnabled ? { pin } : {})
        })
      } catch (reason) {
        const error = reason as JournalApiError
        if (error.code === 'SAVE_FAILED') onErasureFailed(error)
        throw reason
      }
      onErased(erased)
    })
  }

  const validBackup = password.length >= 10 && password === confirmation
  const canErase =
    eraseConfirmation === 'ERASE' &&
    (!view.pinEnabled || pin.length === 6) &&
    (mode === 'backup' ? validBackup : unsavedConfirmed)

  return (
    <section
      aria-labelledby="erasure-title"
      className="border-t border-[var(--danger-border)] pt-8"
    >
      <div className="flex items-center gap-3 text-[var(--danger)]">
        <ShieldAlert aria-hidden="true" size={20} />
        <h2 id="erasure-title" className="settings-heading">
          Erase Journal Vault
        </h2>
      </div>
      <VaultErasureScopeNotice className="mt-4" />

      <fieldset className="mt-5 space-y-3">
        <legend className="field-label">Before erasing</legend>
        <label className="setting-option">
          <input
            checked={mode === 'backup'}
            name="erasure-mode"
            type="radio"
            onChange={() => setMode('backup')}
          />
          Create a Portable Backup first
        </label>
        <label className="setting-option">
          <input
            checked={mode === 'skip'}
            name="erasure-mode"
            type="radio"
            onChange={() => setMode('skip')}
          />
          Erase without creating a backup
        </label>
      </fieldset>

      {mode === 'backup' ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="field-label">Erasure backup password</span>
            <input
              className="text-field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span className="field-label">Confirm erasure backup password</span>
            <input
              className="text-field"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <label className="setting-option mt-4">
          <input
            checked={unsavedConfirmed}
            type="checkbox"
            onChange={(event) => setUnsavedConfirmed(event.target.checked)}
          />
          I understand unsaved writing will be destroyed and no new backup will be created.
        </label>
      )}

      {view.pinEnabled ? (
        <label className="mt-4 block">
          <span className="field-label">Current PIN</span>
          <input
            autoComplete="off"
            className="text-field"
            inputMode="numeric"
            maxLength={6}
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
      ) : null}

      <label className="mt-4 block">
        <span className="field-label">Type ERASE to confirm</span>
        <input
          autoComplete="off"
          className="text-field"
          value={eraseConfirmation}
          onChange={(event) => setEraseConfirmation(event.target.value)}
        />
      </label>
      <button
        className="danger-button mt-5"
        disabled={!canErase || busy === 'erase-vault'}
        type="button"
        onClick={erase}
      >
        <Trash2 aria-hidden="true" size={17} />
        {mode === 'backup' ? 'Back Up and Erase Journal Vault' : 'Erase Journal Vault'}
      </button>
    </section>
  )
}
