import { JournalError } from '../journal-error'
import {
  createEmptyVault,
  JournalVaultRepository,
  type JournalVaultState
} from '../storage/journal-vault-repository'
import type { JournalApplicationOptions } from './journal-application-contract'

interface StateChange<T> {
  state: JournalVaultState
  result: T
  beforeSave?: () => Promise<void>
}

export class JournalSession {
  readonly repository: JournalVaultRepository
  readonly clock: JournalApplicationOptions['clock']
  readonly fileDialogs: JournalApplicationOptions['fileDialogs']

  private statePromise: Promise<JournalVaultState> | null = null
  private writeQueue = Promise.resolve()
  private unlocked = false

  constructor(options: JournalApplicationOptions) {
    this.repository = new JournalVaultRepository(
      options.dataDirectory,
      options.keyProtector,
      options.durableWriter,
      options.vaultFileOperations
    )
    this.clock = options.clock
    this.fileDialogs = options.fileDialogs
  }

  async getState(): Promise<JournalVaultState> {
    this.statePromise ??= this.repository.open()
    const state = await this.statePromise
    if (!state.pinLock) this.unlocked = true
    return state
  }

  async getSettledState(): Promise<JournalVaultState> {
    await this.writeQueue
    return this.getState()
  }

  async getBootstrapState(): Promise<JournalVaultState> {
    await this.writeQueue
    let completedErasure: boolean
    try {
      completedErasure = await this.repository.completePendingErasure()
    } catch {
      throw new JournalError(
        'SAVE_FAILED',
        'Journal Vault Erasure is still in progress. Restart InkPrompts after checking disk access.'
      )
    }
    if (completedErasure) {
      this.statePromise = null
      this.unlocked = true
      return createEmptyVault()
    }
    if (this.statePromise) return this.getState()
    const existing = await this.repository.openExisting()
    if (!existing) {
      this.unlocked = true
      return createEmptyVault()
    }
    this.replaceState(existing)
    if (!existing.pinLock) this.unlocked = true
    return existing
  }

  isUnlocked(): boolean {
    return this.unlocked
  }

  unlock(): void {
    this.unlocked = true
  }

  lock(): void {
    this.unlocked = false
  }

  assertUnlocked(state: JournalVaultState): void {
    if (state.pinLock && !this.unlocked) {
      throw new JournalError('LOCKED', 'Unlock InkPrompts Journal to continue.')
    }
  }

  async commit<T>(change: (state: JournalVaultState) => StateChange<T>): Promise<T> {
    return this.runExclusive(async (current) => {
      const { state: candidate, result, beforeSave } = change(current)
      try {
        await beforeSave?.()
        await this.repository.save(candidate)
      } catch {
        throw new JournalError(
          'SAVE_FAILED',
          'Your latest changes could not be saved. Check disk space and permissions, then try again.'
        )
      }
      this.replaceState(candidate)
      return result
    })
  }

  async runExclusive<T>(operation: (state: JournalVaultState) => Promise<T>): Promise<T> {
    return this.enqueue(operation, true)
  }

  async runRestoreExclusive<T>(
    operation: (state: JournalVaultState | null) => Promise<T>
  ): Promise<T> {
    return this.schedule(async () => {
      const current = this.statePromise
        ? await this.statePromise
        : await this.repository.openExisting()
      if (current && !this.statePromise) this.replaceState(current)
      return operation(current)
    })
  }

  private async enqueue<T>(
    operation: (state: JournalVaultState) => Promise<T>,
    requiresUnlock: boolean
  ): Promise<T> {
    return this.schedule(async () => {
      const current = await this.getState()
      if (requiresUnlock) this.assertUnlocked(current)
      return operation(current)
    })
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.writeQueue.then(operation)
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }

  replaceState(state: JournalVaultState): void {
    this.statePromise = Promise.resolve(state)
  }

  async eraseVault(
    requiresUnlock: boolean,
    validate: (state: JournalVaultState) => void
  ): Promise<JournalVaultState> {
    return this.enqueue(async (state) => {
      validate(state)
      try {
        await this.repository.eraseLocalVault()
      } catch (error) {
        if (error instanceof JournalError && error.code === 'ERASURE_NOT_STARTED') throw error
        this.statePromise = null
        this.unlocked = false
        throw new JournalError(
          'SAVE_FAILED',
          'Journal Vault Erasure did not finish. InkPrompts will continue safely on next launch.'
        )
      }
      this.statePromise = null
      this.unlocked = true
      return createEmptyVault()
    }, requiresUnlock)
  }
}
