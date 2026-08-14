import { renderJournalExport, type JournalExportFormat } from '../export/journal-export'
import { JournalError } from '../journal-error'
import type { JournalVaultState } from '../storage/journal-vault-repository'
import { decryptPortableBackup, encryptPortableBackup } from '../storage/portable-backup'
import { parseVaultState } from '../storage/journal-vault-repository'
import { buildView } from './journal-application-view'
import type { UnlockedApplicationView } from './journal-application-contract'
import type { JournalApplication } from './journal-application-contract'
import type { JournalSession } from './journal-session'
import { randomUUID } from 'node:crypto'

type RecoveryUseCases = Pick<
  JournalApplication,
  | 'listDeviceSnapshots'
  | 'createPortableBackup'
  | 'restorePortableBackup'
  | 'preparePortableBackupRestore'
  | 'commitPortableBackupRestore'
  | 'exportJournal'
  | 'restoreDeviceSnapshot'
  | 'prepareDeviceSnapshotRestore'
  | 'commitDeviceSnapshotRestore'
>

export function createRecoveryUseCases(session: JournalSession): RecoveryUseCases {
  let preparedPortableRestore: { token: string; candidate: JournalVaultState } | null = null
  let preparedSnapshotRestore: {
    token: string
    snapshotId: string
    candidate: JournalVaultState
  } | null = null

  const preparePortableBackupRestore: RecoveryUseCases['preparePortableBackupRestore'] = async (
    input
  ) => {
    preparedPortableRestore = null
    if (!session.fileDialogs)
      throw new JournalError('INVALID_INPUT', 'File dialogs are unavailable.')
    let data: Buffer | null
    try {
      data = await session.fileDialogs.openPortableBackup()
    } catch {
      throw new JournalError('BACKUP_INVALID', 'The selected Portable Backup could not be read.')
    }
    if (!data) return { status: 'cancelled' as const }

    let serialized: string
    try {
      serialized = decryptPortableBackup(data, input.password)
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError(
        'BACKUP_INVALID',
        'The backup password is incorrect, or this Portable Backup is damaged.'
      )
    }
    let restored: JournalVaultState
    try {
      restored = parseVaultState(serialized)
    } catch (error) {
      if (error instanceof JournalError && error.code === 'VAULT_UNSUPPORTED') {
        throw new JournalError(
          'BACKUP_INVALID',
          'This Portable Backup was created by an unsupported version.'
        )
      }
      throw new JournalError(
        'BACKUP_INVALID',
        'This Portable Backup is damaged and was not restored.'
      )
    }
    const token = randomUUID()
    preparedPortableRestore = {
      token,
      candidate: {
        ...restored,
        onboarded: true,
        preferences: { ...restored.preferences, idleLockMinutes: null },
        pinLock: null,
        pinReviewRequired: true,
        lastDailySnapshotDate: null
      }
    }
    return { status: 'ready' as const, token }
  }

  const commitPortableBackupRestore: RecoveryUseCases['commitPortableBackupRestore'] = async (
    token
  ) => {
    if (!preparedPortableRestore || preparedPortableRestore.token !== token) {
      throw new JournalError('INVALID_INPUT', 'Prepare the Portable Backup again before restoring.')
    }
    const { candidate } = preparedPortableRestore
    const result = await session.runRestoreExclusive(async (current) => {
      try {
        if (current && session.isUnlocked()) {
          await session.repository.createDeviceSnapshot(
            'before-restore',
            session.clock.now().toISOString()
          )
        } else if (current) {
          await session.repository.clearDeviceSnapshots()
        }
        if (current) await session.repository.save(candidate)
        else await session.repository.saveInitial(candidate)
      } catch {
        throw new JournalError(
          'SAVE_FAILED',
          'The Portable Backup could not replace the current vault.'
        )
      }
      session.replaceState(candidate)
      session.unlock()
      return {
        status: 'restored' as const,
        pinReviewRequired: true as const,
        view: buildView(candidate, session.clock.today(), 'journal')
      }
    })
    preparedPortableRestore = null
    return result
  }

  const prepareDeviceSnapshotRestore: RecoveryUseCases['prepareDeviceSnapshotRestore'] = async (
    id
  ) => {
    preparedSnapshotRestore = null
    const state = await session.getSettledState()
    session.assertUnlocked(state)
    const candidate = await session.repository.openDeviceSnapshot(id)
    const token = randomUUID()
    preparedSnapshotRestore = { token, snapshotId: id, candidate }
    return { status: 'ready' as const, token }
  }

  const commitDeviceSnapshotRestore: RecoveryUseCases['commitDeviceSnapshotRestore'] = async (
    token
  ) => {
    if (!preparedSnapshotRestore || preparedSnapshotRestore.token !== token) {
      throw new JournalError('INVALID_INPUT', 'Prepare the Device Snapshot again before restoring.')
    }
    const { snapshotId, candidate } = preparedSnapshotRestore
    const result = await session.runExclusive(async () => {
      await session.repository.createDeviceSnapshot(
        'before-restore',
        session.clock.now().toISOString(),
        snapshotId
      )
      try {
        await session.repository.save(candidate)
      } catch {
        throw new JournalError(
          'SAVE_FAILED',
          'The Device Snapshot could not replace the current vault.'
        )
      }
      session.replaceState(candidate)
      return buildView(candidate, session.clock.today(), 'journal')
    })
    preparedSnapshotRestore = null
    return result
  }

  return {
    async listDeviceSnapshots() {
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      return session.repository.listDeviceSnapshots()
    },

    async createPortableBackup(input: { password: string; confirmation: string }) {
      if (input.password !== input.confirmation || input.password.length < 10) {
        throw new JournalError(
          'INVALID_INPUT',
          'Use a backup password of at least 10 characters and confirm it exactly.'
        )
      }
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      if (!session.fileDialogs)
        throw new JournalError('INVALID_INPUT', 'File dialogs are unavailable.')
      try {
        const backup = encryptPortableBackup(JSON.stringify(state), input.password)
        const saved = await session.fileDialogs.savePortableBackup(
          `InkPrompts-Journal-${session.clock.today()}.inkbackup`,
          backup
        )
        return { status: saved ? ('saved' as const) : ('cancelled' as const) }
      } catch {
        throw new JournalError(
          'SAVE_FAILED',
          'The Portable Backup could not be saved. Choose another location and try again.'
        )
      }
    },

    preparePortableBackupRestore,
    commitPortableBackupRestore,

    async restorePortableBackup(input: { password: string }) {
      const preparation = await preparePortableBackupRestore(input)
      if (preparation.status === 'cancelled') return preparation
      return commitPortableBackupRestore(preparation.token)
    },

    async exportJournal(input: { format: JournalExportFormat; unencryptedConfirmed: boolean }) {
      if (
        !['markdown', 'txt', 'json'].includes(input.format) ||
        input.unencryptedConfirmed !== true
      ) {
        throw new JournalError(
          'INVALID_INPUT',
          'Confirm that this ordinary export will be saved without encryption.'
        )
      }
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      if (!session.fileDialogs?.saveExport) {
        throw new JournalError('INVALID_INPUT', 'Export file dialogs are unavailable.')
      }
      const extension = input.format === 'markdown' ? 'md' : input.format
      const data = renderJournalExport(
        Object.values(state.entries),
        input.format,
        session.clock.now().toISOString()
      )
      try {
        const saved = await session.fileDialogs.saveExport(
          `InkPrompts-Journal-${session.clock.today()}.${extension}`,
          data
        )
        return { status: saved ? ('saved' as const) : ('cancelled' as const) }
      } catch {
        throw new JournalError(
          'SAVE_FAILED',
          'The unencrypted export could not be saved. Choose another location and try again.'
        )
      }
    },

    prepareDeviceSnapshotRestore,
    commitDeviceSnapshotRestore,

    async restoreDeviceSnapshot(id: string): Promise<UnlockedApplicationView> {
      const preparation = await prepareDeviceSnapshotRestore(id)
      return commitDeviceSnapshotRestore(preparation.token)
    }
  }
}
