import { useEffect, useState } from 'react'
import { RotateCcw, Shield } from 'lucide-react'
import type { JournalApi } from '../../../../preload/index'
import type { DeviceSnapshot, UnlockedView } from '../../types'
import type { RunSettingAction } from './types'
import type { ProtectPendingDraft } from '../../pending-draft'

interface RecoverySettingsProps {
  api: JournalApi
  open: boolean
  run: RunSettingAction
  requireDurableDraft(): Promise<void>
  onError(message: string): void
  onRestore(view: UnlockedView): void
  onPendingDraftReleased(): void
  protectPendingDraft: ProtectPendingDraft
  showMessage(message: string): void
}

export function RecoverySettings({
  api,
  open,
  run,
  requireDurableDraft,
  onError,
  onRestore,
  onPendingDraftReleased,
  protectPendingDraft,
  showMessage
}: RecoverySettingsProps): React.JSX.Element {
  const [snapshots, setSnapshots] = useState<DeviceSnapshot[]>([])
  const [backupPassword, setBackupPassword] = useState('')
  const [backupConfirmation, setBackupConfirmation] = useState('')

  useEffect(() => {
    if (!open) return
    void api
      .listDeviceSnapshots()
      .then(setSnapshots)
      .catch((reason: Error) => onError(reason.message))
  }, [api, onError, open])

  const createBackup = (): void => {
    run('backup', async () => {
      await requireDurableDraft()
      const result = await api.createPortableBackup({
        password: backupPassword,
        confirmation: backupConfirmation
      })
      showMessage(result.status === 'saved' ? 'Portable Backup created.' : 'Backup cancelled.')
      setBackupPassword('')
      setBackupConfirmation('')
    })
  }

  const restoreBackup = (): void => {
    run('restore-backup', async () => {
      if (
        !window.confirm(
          'Replace the current Journal Vault with a Portable Backup? A Device Snapshot will protect the current state first.'
        )
      ) {
        return
      }
      const preparation = await api.preparePortableBackupRestore({ password: backupPassword })
      if (preparation.status === 'cancelled') {
        showMessage('Restore cancelled.')
        return
      }
      const decision = await protectPendingDraft({ action: 'restore this Portable Backup' })
      if (decision === 'cancelled') {
        showMessage('Restore cancelled. The Pending Draft remains available.')
        return
      }
      const result = await api.commitPortableBackupRestore(preparation.token)
      onPendingDraftReleased()
      onRestore(result.view)
      setSnapshots(await api.listDeviceSnapshots())
      showMessage(
        'Portable Backup restored. PIN Lock is off on this device; review it below if needed.'
      )
      setBackupPassword('')
    })
  }

  const restoreSnapshot = (snapshot: DeviceSnapshot): void => {
    if (
      !window.confirm(
        `Restore the Device Snapshot from ${new Date(snapshot.createdAt).toLocaleString()}? The current vault will be snapshotted first.`
      )
    ) {
      return
    }
    run(`snapshot-${snapshot.id}`, async () => {
      const preparation = await api.prepareDeviceSnapshotRestore(snapshot.id)
      const decision = await protectPendingDraft({ action: 'restore this Device Snapshot' })
      if (decision === 'cancelled') {
        showMessage('Restore cancelled. The Pending Draft remains available.')
        return
      }
      const restored = await api.commitDeviceSnapshotRestore(preparation.token)
      onPendingDraftReleased()
      onRestore(restored)
      setSnapshots(await api.listDeviceSnapshots())
      showMessage('Device Snapshot restored.')
    })
  }

  return (
    <>
      <section aria-labelledby="recovery-title">
        <div className="flex items-center gap-3">
          <Shield aria-hidden="true" className="text-[var(--accent-text)]" size={20} />
          <h2 id="recovery-title" className="settings-heading">
            Recovery & portability
          </h2>
        </div>
        <p className="settings-copy">
          A Portable Backup uses its own password and works on another supported device. That
          password cannot be recovered.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="field-label">Backup password</span>
            <input
              className="text-field"
              type="password"
              value={backupPassword}
              onChange={(event) => setBackupPassword(event.target.value)}
            />
          </label>
          <label>
            <span className="field-label">Confirm for a new backup</span>
            <input
              className="text-field"
              type="password"
              value={backupConfirmation}
              onChange={(event) => setBackupConfirmation(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="secondary-button"
            disabled={backupPassword.length < 10 || backupPassword !== backupConfirmation}
            type="button"
            onClick={createBackup}
          >
            Create Portable Backup
          </button>
          <button
            className="text-button"
            disabled={backupPassword.length < 1}
            type="button"
            onClick={restoreBackup}
          >
            Restore Portable Backup
          </button>
        </div>
      </section>

      <section aria-labelledby="snapshots-title">
        <h2 id="snapshots-title" className="settings-heading">
          Device Snapshots
        </h2>
        <p className="settings-copy">
          Encrypted with this device’s system key. They cannot be moved to another device.
        </p>
        <ul className="mt-4 space-y-2">
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <li key={snapshot.id} className="snapshot-row">
                <div>
                  <p className="text-sm font-medium">{snapshot.reason.replaceAll('-', ' ')}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {new Date(snapshot.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  aria-label={`Restore snapshot from ${new Date(snapshot.createdAt).toLocaleString()}`}
                  className="icon-button"
                  type="button"
                  onClick={() => restoreSnapshot(snapshot)}
                >
                  <RotateCcw aria-hidden="true" size={17} />
                </button>
              </li>
            ))
          ) : (
            <li className="text-sm text-[var(--text-muted)]">No Device Snapshots yet.</li>
          )}
        </ul>
      </section>
    </>
  )
}
