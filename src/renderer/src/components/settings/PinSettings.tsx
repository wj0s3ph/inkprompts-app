import { useState } from 'react'
import { AlertTriangle, KeyRound } from 'lucide-react'
import type { CommonSettingsProps } from './types'

export function PinSettings({
  api,
  busy,
  run,
  view,
  refresh,
  showMessage
}: CommonSettingsProps): React.JSX.Element {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinConfirmation, setPinConfirmation] = useState('')

  const configurePin = (): void => {
    run('pin', async () => {
      await api.configurePin({
        ...(view.pinEnabled ? { currentPin } : {}),
        pin: newPin,
        confirmation: pinConfirmation
      })
      setCurrentPin('')
      setNewPin('')
      setPinConfirmation('')
      showMessage('PIN Lock updated.')
      await refresh()
    })
  }

  const disablePin = (): void => {
    run('pin-disable', async () => {
      await api.disablePin(currentPin)
      setCurrentPin('')
      showMessage('PIN Lock disabled.')
      await refresh()
    })
  }

  return (
    <section aria-labelledby="pin-title">
      <div className="flex items-center gap-3">
        <KeyRound aria-hidden="true" className="text-[var(--accent-text)]" size={20} />
        <h2 id="pin-title" className="settings-heading">
          PIN Lock
        </h2>
      </div>
      <p className="settings-copy">
        A PIN is an app privacy lock, not a strong encryption password. There is no account
        recovery.
      </p>
      <aside aria-label="PIN recovery warning" className="settings-warning mt-4" role="note">
        <AlertTriangle aria-hidden="true" size={20} />
        <div>
          <p className="font-semibold">Your PIN cannot be recovered or reset.</p>
          <p>
            If you forget it, you must restore a Portable Backup or permanently erase this device’s
            Journal Vault. Create a Portable Backup before enabling PIN Lock.
          </p>
        </div>
      </aside>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {view.pinEnabled ? (
          <PinField
            id="current-pin"
            label="Current PIN"
            value={currentPin}
            onChange={setCurrentPin}
          />
        ) : null}
        <PinField id="new-pin" label="New 6-digit PIN" value={newPin} onChange={setNewPin} />
        <PinField
          id="confirm-pin"
          label="Confirm new PIN"
          value={pinConfirmation}
          onChange={setPinConfirmation}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="secondary-button"
          disabled={newPin.length !== 6 || pinConfirmation.length !== 6 || busy === 'pin'}
          type="button"
          onClick={configurePin}
        >
          {view.pinEnabled ? 'Change PIN' : 'Enable PIN Lock'}
        </button>
        {view.pinEnabled ? (
          <button
            className="danger-button"
            disabled={currentPin.length !== 6}
            type="button"
            onClick={disablePin}
          >
            Disable PIN Lock
          </button>
        ) : null}
      </div>
    </section>
  )
}

interface PinFieldProps {
  id: string
  label: string
  value: string
  onChange(value: string): void
}

function PinField({ id, label, value, onChange }: PinFieldProps): React.JSX.Element {
  return (
    <label>
      <span className="field-label">{label}</span>
      <input
        id={id}
        autoComplete="off"
        className="text-field"
        inputMode="numeric"
        maxLength={6}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </label>
  )
}
