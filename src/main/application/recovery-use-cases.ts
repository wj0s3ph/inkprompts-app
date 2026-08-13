import { renderJournalExport, type JournalExportFormat } from '../export/journal-export'
import { JournalError } from '../journal-error'
import type { JournalVaultState } from '../storage/journal-vault-repository'
import { decryptPortableBackup, encryptPortableBackup } from '../storage/portable-backup'
import { parseVaultState } from '../storage/journal-vault-repository'
import { buildView } from './journal-application-view'
import type { UnlockedApplicationView } from './journal-application-contract'
import type { JournalApplication } from './journal-application-contract'
import type { JournalSession } from './journal-session'

type RecoveryUseCases = Pick<
  JournalApplication,
  | 'listDeviceSnapshots'
  | 'createPortableBackup'
  | 'restorePortableBackup'
  | 'exportJournal'
  | 'restoreDeviceSnapshot'
>

export function createRecoveryUseCases(session: JournalSession): RecoveryUseCases {
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

    async restorePortableBackup(input: { password: string }) {
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
      const candidate: JournalVaultState = {
        ...restored,
        onboarded: true,
        pinLock: null,
        pinReviewRequired: true,
        lastDailySnapshotDate: null
      }
      return session.runRestoreExclusive(async (current) => {
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

    async restoreDeviceSnapshot(id: string): Promise<UnlockedApplicationView> {
      return session.runExclusive(async () => {
        await session.repository.createDeviceSnapshot(
          'before-restore',
          session.clock.now().toISOString(),
          id
        )
        const restored = await session.repository.openDeviceSnapshot(id)
        try {
          await session.repository.save(restored)
        } catch {
          throw new JournalError(
            'SAVE_FAILED',
            'The Device Snapshot could not replace the current vault.'
          )
        }
        session.replaceState(restored)
        return buildView(restored, session.clock.today(), 'journal')
      })
    }
  }
}
