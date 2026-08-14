import { randomBytes, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import {
  assertRichTextDocument,
  type DailyEntry,
  type DeviceSnapshotMetadata,
  type DeviceSnapshotReason,
  type HabitRecipe,
  type JournalPreferences,
  type RichTextDocument
} from '../../shared/journal-contract'
import { decryptEnvelope, encryptEnvelope } from './encrypted-envelope'
import type { PinLockRecord } from '../security/pin-lock'
import { JournalError } from '../journal-error'

export interface KeyProtector {
  assertAvailable(): void
  protect(key: Uint8Array): string
  unprotect(value: string): Uint8Array
}

export interface JournalVaultState {
  schemaVersion: 2
  onboarded: boolean
  entries: Record<string, DailyEntry>
  preferences: JournalPreferences
  habitRecipe: HabitRecipe | null
  habitRecipeInviteDismissed: boolean
  habitRecipeReviewAsked: boolean
  pinLock: PinLockRecord | null
  lastDailySnapshotDate: string | null
  pinReviewRequired: boolean
}

export interface DurableWriter {
  write(path: string, data: string): Promise<void>
}

export interface VaultFileOperations {
  exists(path: string): Promise<boolean>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
}

const defaultWriter: DurableWriter = {
  write(path, data) {
    return writeFileAtomic(path, data, { encoding: 'utf8', fsync: true, mode: 0o600 })
  }
}

const defaultFileOperations: VaultFileOperations = {
  async exists(path) {
    try {
      await access(path)
      return true
    } catch (error) {
      if (isMissingFile(error)) return false
      throw error
    }
  },
  async remove(path, options) {
    await rm(path, { force: true, ...(options?.recursive ? { recursive: true } : {}) })
  }
}

export class JournalVaultRepository {
  readonly vaultPath: string
  private readonly keyPath: string
  private readonly snapshotDirectory: string
  private readonly snapshotManifestPath: string
  private readonly erasureMarkerPath: string
  private key: Uint8Array | null = null

  constructor(
    private readonly dataDirectory: string,
    private readonly keyProtector: KeyProtector,
    private readonly writer: DurableWriter = defaultWriter,
    private readonly fileOperations: VaultFileOperations = defaultFileOperations
  ) {
    this.vaultPath = join(dataDirectory, 'journal.vault')
    this.keyPath = join(dataDirectory, 'journal.key')
    this.snapshotDirectory = join(dataDirectory, 'snapshots')
    this.snapshotManifestPath = join(this.snapshotDirectory, 'manifest.json')
    this.erasureMarkerPath = join(dataDirectory, 'journal-erasure.pending')
  }

  async open(): Promise<JournalVaultState> {
    const existing = await this.openExisting()
    if (existing) return existing
    try {
      await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 })
      const initial = createEmptyVault()
      await this.saveInitial(initial)
      return initial
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError(
        'SAVE_FAILED',
        'Journal storage could not be opened. Check disk access and permissions, then restart.'
      )
    }
  }

  async openExisting(): Promise<JournalVaultState | null> {
    try {
      this.keyProtector.assertAvailable()
      await this.completePendingErasure()
      const [keyExists, vaultExists] = await Promise.all([
        this.fileOperations.exists(this.keyPath),
        this.fileOperations.exists(this.vaultPath)
      ])
      if (!keyExists && !vaultExists) return null
      if (!keyExists) {
        throw new JournalError(
          'SYSTEM_KEY_UNAVAILABLE',
          'The Journal Vault key is missing. The existing vault was not changed.'
        )
      }
      if (!vaultExists) throw vaultCorruptError()

      const key = await this.loadOrCreateKey()
      const serialized = await readFile(this.vaultPath, 'utf8')
      const plaintext = decryptEnvelope(serialized, key)
      const sourceVersion = readSchemaVersion(plaintext)
      const state = parseVaultState(plaintext)
      if (sourceVersion === 1 || needsIdleLockMigration(plaintext)) await this.save(state)
      return state
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError(
        'SAVE_FAILED',
        'Journal storage could not be opened. Check disk access and permissions, then restart.'
      )
    }
  }

  async save(state: JournalVaultState): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 })
    const key = this.key ?? (await this.loadOrCreateKey())
    await this.writer.write(this.vaultPath, encryptEnvelope(JSON.stringify(state), key))
  }

  async saveInitial(state: JournalVaultState): Promise<void> {
    try {
      await this.save(state)
    } catch (error) {
      this.key = null
      await Promise.allSettled([
        this.fileOperations.remove(this.vaultPath),
        this.fileOperations.remove(this.keyPath),
        this.fileOperations.remove(this.snapshotDirectory, { recursive: true })
      ])
      throw error
    }
  }

  async eraseLocalVault(): Promise<void> {
    try {
      await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 })
      await this.writer.write(
        this.erasureMarkerPath,
        JSON.stringify({ format: 'inkprompts-journal-erasure', version: 1 })
      )
    } catch (error) {
      if (!(await this.fileOperations.exists(this.erasureMarkerPath))) {
        throw new JournalError(
          'ERASURE_NOT_STARTED',
          'Journal Vault Erasure could not start. No App-managed journal data was deleted.'
        )
      }
      throw error
    }
    await this.completePendingErasure()
  }

  async completePendingErasure(): Promise<boolean> {
    if (!(await this.fileOperations.exists(this.erasureMarkerPath))) return false
    this.key = null
    await this.fileOperations.remove(this.keyPath)
    await this.fileOperations.remove(this.vaultPath)
    await this.fileOperations.remove(this.snapshotDirectory, { recursive: true })

    for (const path of [this.keyPath, this.vaultPath, this.snapshotDirectory]) {
      if (await this.fileOperations.exists(path)) {
        throw new Error(`Managed Journal Vault data remains at ${path}`)
      }
    }
    await this.fileOperations.remove(this.erasureMarkerPath)
    return true
  }

  async clearDeviceSnapshots(): Promise<void> {
    await rm(this.snapshotDirectory, { force: true, recursive: true })
  }

  async createDeviceSnapshot(
    reason: DeviceSnapshotReason,
    createdAt: string,
    retainedSnapshotId?: string
  ): Promise<DeviceSnapshotMetadata> {
    await mkdir(this.snapshotDirectory, { recursive: true, mode: 0o700 })
    const encryptedVault = await readFile(this.vaultPath, 'utf8')
    const metadata: DeviceSnapshotMetadata = {
      id: `${createdAt.replace(/[^\d]/g, '')}-${randomUUID()}`,
      createdAt,
      reason,
      deviceBound: true
    }
    await this.writer.write(this.snapshotPath(metadata.id), encryptedVault)

    const existing = await this.readSnapshotManifest()
    const ordered = [...existing, metadata].sort(compareSnapshots)
    const removalCount = Math.max(0, ordered.length - 30)
    const removed = ordered
      .filter((snapshot) => snapshot.id !== retainedSnapshotId)
      .slice(0, removalCount)
    const removedIds = new Set(removed.map((snapshot) => snapshot.id))
    const retained = ordered.filter((snapshot) => !removedIds.has(snapshot.id))
    await this.writer.write(this.snapshotManifestPath, JSON.stringify(retained))
    await Promise.all(
      removed.map((snapshot) => rm(this.snapshotPath(snapshot.id), { force: true }))
    )
    return metadata
  }

  async listDeviceSnapshots(): Promise<DeviceSnapshotMetadata[]> {
    return (await this.readSnapshotManifest()).sort(compareSnapshots).reverse()
  }

  async openDeviceSnapshot(id: string): Promise<JournalVaultState> {
    const metadata = (await this.readSnapshotManifest()).find((snapshot) => snapshot.id === id)
    if (!metadata) throw new JournalError('INVALID_INPUT', 'Choose an available Device Snapshot.')
    try {
      const encryptedVault = await readFile(this.snapshotPath(metadata.id), 'utf8')
      const key = this.key ?? (await this.loadOrCreateKey())
      return parseVaultState(decryptEnvelope(encryptedVault, key))
    } catch (error) {
      if (error instanceof JournalError) throw error
      throw new JournalError(
        'VAULT_CORRUPT',
        'This Device Snapshot is damaged or cannot be restored.'
      )
    }
  }

  private async loadOrCreateKey(): Promise<Uint8Array> {
    if (this.key) return this.key

    try {
      const protectedKey = await readFile(this.keyPath, 'utf8')
      this.key = this.keyProtector.unprotect(protectedKey)
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new JournalError(
          'SYSTEM_KEY_UNAVAILABLE',
          'The operating system could not unlock this Journal Vault key.'
        )
      }
      this.key = randomBytes(32)
      await this.writer.write(this.keyPath, this.keyProtector.protect(this.key))
    }

    if (this.key.byteLength !== 32) {
      throw new JournalError(
        'SYSTEM_KEY_UNAVAILABLE',
        'The operating system returned an invalid Journal Vault key.'
      )
    }
    return this.key
  }

  private async readSnapshotManifest(): Promise<DeviceSnapshotMetadata[]> {
    let value: unknown
    try {
      value = JSON.parse(await readFile(this.snapshotManifestPath, 'utf8'))
    } catch (error) {
      if (isMissingFile(error)) return []
      throw snapshotCorruptError()
    }
    if (!Array.isArray(value)) throw snapshotCorruptError()
    for (const snapshot of value) {
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        typeof snapshot.id !== 'string' ||
        typeof snapshot.createdAt !== 'string' ||
        !['daily', 'before-delete', 'before-restore'].includes(snapshot.reason) ||
        snapshot.deviceBound !== true
      ) {
        throw snapshotCorruptError()
      }
    }
    return value as DeviceSnapshotMetadata[]
  }

  private snapshotPath(id: string): string {
    return join(this.snapshotDirectory, `${id}.vault`)
  }
}

export function createEmptyVault(): JournalVaultState {
  return {
    schemaVersion: 2,
    onboarded: false,
    entries: {},
    preferences: { theme: 'system', spellcheck: true, idleLockMinutes: null },
    habitRecipe: null,
    habitRecipeInviteDismissed: false,
    habitRecipeReviewAsked: false,
    pinLock: null,
    lastDailySnapshotDate: null,
    pinReviewRequired: false
  }
}

export function parseVaultState(serialized: string): JournalVaultState {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw vaultCorruptError()
  }
  if (!value || typeof value !== 'object') throw vaultCorruptError()
  const state = value as Partial<JournalVaultState>
  if (![1, 2].includes(state.schemaVersion as number)) {
    throw new JournalError(
      'VAULT_UNSUPPORTED',
      'This Journal Vault was created by an unsupported version. The original file was not changed.'
    )
  }
  if (typeof state.onboarded !== 'boolean' || !state.entries) {
    throw vaultCorruptError()
  }
  if (typeof state.entries !== 'object' || Array.isArray(state.entries)) throw vaultCorruptError()

  const pinLock = state.pinLock ?? null
  if (pinLock) assertPinLock(pinLock)
  const storedPreferences = (state.preferences ?? {
    theme: 'system',
    spellcheck: true
  }) as Partial<JournalPreferences>
  const preferences: JournalPreferences = {
    theme: storedPreferences.theme as JournalPreferences['theme'],
    spellcheck: storedPreferences.spellcheck as boolean,
    idleLockMinutes: Object.hasOwn(storedPreferences, 'idleLockMinutes')
      ? (storedPreferences.idleLockMinutes as JournalPreferences['idleLockMinutes'])
      : pinLock
        ? 15
        : null
  }
  if (
    !['system', 'light', 'dark'].includes(preferences.theme) ||
    typeof preferences.spellcheck !== 'boolean' ||
    (pinLock
      ? !['off', 5, 15, 30, 60].includes(preferences.idleLockMinutes as string | number)
      : preferences.idleLockMinutes !== null)
  ) {
    throw vaultCorruptError()
  }

  const habitRecipe = state.habitRecipe ?? null
  if (habitRecipe) assertHabitRecipe(habitRecipe)
  const habitRecipeInviteDismissed = state.habitRecipeInviteDismissed ?? false
  const habitRecipeReviewAsked = state.habitRecipeReviewAsked ?? false
  const lastDailySnapshotDate = state.lastDailySnapshotDate ?? null
  const pinReviewRequired = state.pinReviewRequired ?? false
  if (
    typeof habitRecipeInviteDismissed !== 'boolean' ||
    typeof habitRecipeReviewAsked !== 'boolean'
  ) {
    throw vaultCorruptError()
  }
  if (lastDailySnapshotDate !== null && typeof lastDailySnapshotDate !== 'string') {
    throw vaultCorruptError()
  }
  if (typeof pinReviewRequired !== 'boolean') throw vaultCorruptError()

  for (const [date, entry] of Object.entries(state.entries)) assertDailyEntry(date, entry)
  return {
    ...(state as JournalVaultState),
    schemaVersion: 2,
    preferences,
    habitRecipe,
    habitRecipeInviteDismissed,
    habitRecipeReviewAsked,
    pinLock,
    lastDailySnapshotDate,
    pinReviewRequired
  }
}

function needsIdleLockMigration(serialized: string): boolean {
  try {
    const state = JSON.parse(serialized) as { preferences?: Record<string, unknown> }
    return !state.preferences || !Object.hasOwn(state.preferences, 'idleLockMinutes')
  } catch {
    return false
  }
}

function assertPinLock(value: PinLockRecord): void {
  if (
    typeof value.salt !== 'string' ||
    typeof value.hash !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw vaultCorruptError()
  }
}

function assertHabitRecipe(value: HabitRecipe): void {
  if (
    typeof value.anchor !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.sentence !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw vaultCorruptError()
  }
}

function assertDailyEntry(date: string, value: unknown): asserts value is DailyEntry {
  if (!value || typeof value !== 'object') throw vaultCorruptError()
  const entry = value as Partial<DailyEntry>
  if (
    entry.date !== date ||
    typeof entry.title !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    typeof entry.updatedAt !== 'string' ||
    (entry.completedAt !== null && typeof entry.completedAt !== 'string')
  ) {
    throw vaultCorruptError()
  }
  try {
    assertRichTextDocument(entry.content as RichTextDocument)
  } catch {
    throw vaultCorruptError()
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function compareSnapshots(left: DeviceSnapshotMetadata, right: DeviceSnapshotMetadata): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function readSchemaVersion(serialized: string): number {
  try {
    const value = JSON.parse(serialized) as { schemaVersion?: unknown }
    return typeof value.schemaVersion === 'number' ? value.schemaVersion : -1
  } catch {
    throw vaultCorruptError()
  }
}

function vaultCorruptError(): JournalError {
  return new JournalError(
    'VAULT_CORRUPT',
    'The Journal Vault is damaged or incomplete. The original file was not changed.'
  )
}

function snapshotCorruptError(): JournalError {
  return new JournalError(
    'VAULT_CORRUPT',
    'Device Snapshot metadata is damaged. The current Journal Vault was not changed.'
  )
}
