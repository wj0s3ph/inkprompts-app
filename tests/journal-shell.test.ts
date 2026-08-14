import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, test } from 'vitest'
import {
  createJournalApplication,
  type JournalApplication
} from '../src/main/application/create-journal-application'
import { decryptEnvelope, encryptEnvelope } from '../src/main/storage/encrypted-envelope'
import { encryptPortableBackup } from '../src/main/storage/portable-backup'
import { emptyRichTextDocument, type RichTextDocument } from '../src/shared/journal-contract'

const testDirectories: string[] = []

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'inkprompts-journal-'))
  testDirectories.push(directory)
  return directory
}

const keyProtector = {
  assertAvailable(): void {
    return undefined
  },
  protect(key: Uint8Array): string {
    return Buffer.from(key).toString('base64')
  },
  unprotect(value: string): Uint8Array {
    return Buffer.from(value, 'base64')
  }
}

const firstSentence = {
  type: 'doc' as const,
  version: 1 as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: 'Today I chose to begin again.' }]
    }
  ]
}

const searchableSentence = {
  type: 'doc' as const,
  version: 1 as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: 'Morning coffee made the apartment feel quiet.' }]
    }
  ]
}

const formattedDocument = {
  type: 'doc' as const,
  version: 1 as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [
        { type: 'text' as const, text: 'Bold', marks: [{ type: 'bold' as const }] },
        { type: 'text' as const, text: ' and ' },
        { type: 'text' as const, text: 'italic', marks: [{ type: 'italic' as const }] },
        { type: 'text' as const, text: ' with ' },
        {
          type: 'text' as const,
          text: 'a link',
          marks: [{ type: 'link' as const, attrs: { href: 'https://example.com' } }]
        }
      ]
    },
    {
      type: 'bulletList' as const,
      content: [
        {
          type: 'listItem' as const,
          content: [
            { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Tea' }] }
          ]
        }
      ]
    },
    {
      type: 'orderedList' as const,
      content: [
        {
          type: 'listItem' as const,
          content: [
            { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Write' }] }
          ]
        }
      ]
    },
    {
      type: 'blockquote' as const,
      content: [
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Enough.' }] }
      ]
    }
  ]
}

function makeApplication(
  dataDirectory: string,
  durableWriter?: { write(path: string, data: string): Promise<void> },
  clock = {
    now: () => new Date('2026-08-11T09:00:00.000+08:00'),
    today: () => '2026-08-11'
  },
  fileDialogs?: {
    savePortableBackup(suggestedName: string, data: Buffer): Promise<boolean>
    openPortableBackup(): Promise<Buffer | null>
    saveExport?(suggestedName: string, data: string): Promise<boolean>
  },
  vaultFileOperations?: {
    exists(path: string): Promise<boolean>
    remove(path: string, options?: { recursive?: boolean }): Promise<void>
  }
): JournalApplication {
  return createJournalApplication({
    dataDirectory,
    clock,
    keyProtector,
    durableWriter,
    fileDialogs,
    vaultFileOperations
  })
}

async function expectManagedVaultAbsent(dataDirectory: string): Promise<void> {
  for (const path of [
    join(dataDirectory, 'journal.key'),
    join(dataDirectory, 'journal.vault'),
    join(dataDirectory, 'snapshots'),
    join(dataDirectory, 'journal-erasure.pending')
  ]) {
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('InkPrompts Journal shell', () => {
  test('a fresh local journal opens Welcome and enters an empty Today without an account', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)

    await expect(application.bootstrap()).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'welcome',
      today: '2026-08-11'
    })
    await expectManagedVaultAbsent(dataDirectory)

    await expect(application.startWriting()).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'journal',
      selectedDate: '2026-08-11',
      selectedEntry: null,
      entryDates: [],
      writingStarter: {
        question: 'What do you want to remember about today?',
        placeholder: 'Right now, I...'
      }
    })
  })

  test('a failed first write leaves Welcome recoverable without a partial key or vault', async () => {
    const dataDirectory = await makeDataDirectory()
    let failVaultWrite = true
    const application = makeApplication(dataDirectory, {
      async write(path, data) {
        if (failVaultWrite && path.endsWith('journal.vault')) {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        }
        await writeFile(path, data, { mode: 0o600 })
      }
    })

    await expect(application.startWriting()).rejects.toMatchObject({ code: 'SAVE_FAILED' })
    await expectManagedVaultAbsent(dataDirectory)

    failVaultWrite = false
    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      screen: 'welcome'
    })
  })

  test('cancelling or failing Welcome restore leaves no Journal Vault half-product', async () => {
    const sourceDirectory = await makeDataDirectory()
    let backup: Buffer | undefined
    const source = makeApplication(sourceDirectory, undefined, undefined, {
      async savePortableBackup(_name, data) {
        backup = Buffer.from(data)
        return true
      },
      async openPortableBackup() {
        return null
      }
    })
    await source.startWriting()
    await source.saveEntry({ date: '2026-08-11', title: 'Portable', content: firstSentence })
    await source.createPortableBackup({
      password: 'portable backup password',
      confirmation: 'portable backup password'
    })

    const destinationDirectory = await makeDataDirectory()
    let selectedBackup: Buffer | null = null
    const destination = makeApplication(destinationDirectory, undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return selectedBackup
      }
    })

    await expect(destination.bootstrap()).resolves.toMatchObject({ screen: 'welcome' })
    await expect(
      destination.restorePortableBackup({ password: 'portable backup password' })
    ).resolves.toEqual({ status: 'cancelled' })
    await expectManagedVaultAbsent(destinationDirectory)

    selectedBackup = backup!
    await expect(
      destination.restorePortableBackup({ password: 'wrong backup password' })
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    await expectManagedVaultAbsent(destinationDirectory)
    await expect(makeApplication(destinationDirectory).bootstrap()).resolves.toMatchObject({
      screen: 'welcome'
    })
  })

  test('the first Today sentence is encrypted at rest and restored after restart', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)

    await application.startWriting()
    await expect(
      application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })
    ).resolves.toMatchObject({
      status: 'saved',
      entry: {
        date: '2026-08-11',
        content: firstSentence
      },
      entryDates: ['2026-08-11']
    })

    const bytesOnDisk = await readFile(join(dataDirectory, 'journal.vault'), 'utf8')
    expect(bytesOnDisk).not.toContain('Today I chose to begin again.')

    const restarted = makeApplication(dataDirectory)
    await expect(restarted.bootstrap()).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'journal',
      selectedDate: '2026-08-11',
      selectedEntry: {
        date: '2026-08-11',
        content: firstSentence
      }
    })
  })

  test('an oversized rich-text document is rejected before it reaches durable storage', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    const oversized = {
      type: 'doc' as const,
      version: 1 as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'a'.repeat(1_000_001) }]
        },
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'b'.repeat(1_000_001) }]
        }
      ]
    }

    await expect(
      application.saveEntry({ date: '2026-08-11', title: '', content: oversized })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  test('a tampered Journal Vault fails closed without replacing the source file', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })

    const vaultPath = join(dataDirectory, 'journal.vault')
    const original = await readFile(vaultPath, 'utf8')
    const tampered = original.replace(/"ciphertext":"./, '"ciphertext":"!')
    await writeFile(vaultPath, tampered)

    await expect(makeApplication(dataDirectory).bootstrap()).rejects.toMatchObject({
      code: 'VAULT_CORRUPT'
    })
    await expect(readFile(vaultPath, 'utf8')).resolves.toBe(tampered)
  })

  test('a failed durable save leaves the last acknowledged Journal Vault unchanged', async () => {
    const dataDirectory = await makeDataDirectory()
    let failWrites = false
    const application = makeApplication(dataDirectory, {
      async write(path, data) {
        if (failWrites && path.endsWith('journal.vault')) {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        }
        await writeFile(path, data, { mode: 0o600 })
      }
    })

    await application.startWriting()
    failWrites = true
    await expect(
      application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' })

    failWrites = false
    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      selectedEntry: null,
      entryDates: []
    })
  })

  test('one Daily Entry is reopened by stable local date while future dates stay read-only', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.saveEntry({
      date: '2024-02-29',
      title: 'Leap day',
      content: firstSentence
    })
    await application.saveEntry({
      date: '2024-02-29',
      title: 'Leap day remembered',
      content: firstSentence
    })

    await expect(application.openDate('2024-02-29')).resolves.toMatchObject({
      selectedDate: '2024-02-29',
      editable: true,
      selectedEntry: {
        date: '2024-02-29',
        title: 'Leap day remembered'
      },
      entryDates: ['2024-02-29']
    })
    await expect(application.openDate('2026-08-12')).resolves.toMatchObject({
      selectedDate: '2026-08-12',
      editable: false,
      selectedEntry: null
    })
    await expect(
      application.saveEntry({ date: '2026-08-12', title: 'Tomorrow', content: firstSentence })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  test('calendar validation keeps leap days and year boundaries stable', async () => {
    const application = makeApplication(await makeDataDirectory(), undefined, {
      now: () => new Date('2027-01-01T12:00:00.000Z'),
      today: () => '2027-01-01'
    })
    await application.startWriting()
    await application.saveEntry({ date: '2024-02-29', title: 'Leap day', content: firstSentence })
    await application.saveEntry({
      date: '2026-12-31',
      title: 'Year boundary',
      content: firstSentence
    })

    await expect(application.openDate('2024-02-29')).resolves.toMatchObject({
      selectedEntry: { title: 'Leap day' },
      editable: true
    })
    await expect(application.openDate('2025-02-29')).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await expect(
      application.saveEntry({ date: '2027-01-02', title: 'Future', content: firstSentence })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(application.bootstrap()).resolves.toMatchObject({
      selectedDate: '2027-01-01',
      entryDates: ['2024-02-29', '2026-12-31']
    })
  })

  test('theme and native spellcheck preferences persist without changing journal content', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()

    await expect(
      application.updatePreferences({ theme: 'dark', spellcheck: false, idleLockMinutes: null })
    ).resolves.toEqual({ theme: 'dark', spellcheck: false, idleLockMinutes: null })

    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      preferences: { theme: 'dark', spellcheck: false, idleLockMinutes: null },
      selectedEntry: null
    })
  })

  test('PIN Lock owns a durable idle timeout without reviving disabled settings', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()

    await expect(application.bootstrap()).resolves.toMatchObject({
      preferences: { idleLockMinutes: null }
    })
    await application.configurePin({ pin: '123456', confirmation: '123456' })
    await expect(application.bootstrap()).resolves.toMatchObject({
      preferences: { idleLockMinutes: 15 }
    })
    await application.updatePreferences({
      theme: 'system',
      spellcheck: true,
      idleLockMinutes: 'off'
    })
    await application.configurePin({
      currentPin: '123456',
      pin: '654321',
      confirmation: '654321'
    })
    await expect(makeApplication(dataDirectory).unlock('654321')).resolves.toMatchObject({
      preferences: { idleLockMinutes: 'off' }
    })

    await application.disablePin('654321')
    await expect(application.bootstrap()).resolves.toMatchObject({
      preferences: { idleLockMinutes: null }
    })
    await application.configurePin({ pin: '123456', confirmation: '123456' })
    await expect(application.bootstrap()).resolves.toMatchObject({
      preferences: { idleLockMinutes: 15 }
    })
  })

  test.each([
    { pin: false, expected: null },
    { pin: true, expected: 15 }
  ])('migrates an older idle-lock preference for PIN=$pin', async ({ pin, expected }) => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    if (pin) await application.configurePin({ pin: '123456', confirmation: '123456' })

    const protectedKey = await readFile(join(dataDirectory, 'journal.key'), 'utf8')
    const key = keyProtector.unprotect(protectedKey)
    const vaultPath = join(dataDirectory, 'journal.vault')
    const legacyState = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    delete legacyState.preferences.idleLockMinutes
    await writeFile(vaultPath, encryptEnvelope(JSON.stringify(legacyState), key))

    const restarted = makeApplication(dataDirectory)
    const view = pin ? await restarted.unlock('123456') : await restarted.bootstrap()
    expect(view).toMatchObject({ preferences: { idleLockMinutes: expected } })
    const migrated = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    expect(migrated.preferences.idleLockMinutes).toBe(expected)
  })

  test('Done for Today celebrates only the first durable completion and keeps the entry editable', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })

    const firstCompletion = await application.completeToday()
    expect(firstCompletion).toMatchObject({
      celebrated: true,
      message: 'Saved. One sentence counts.',
      recipePrompt: 'invite',
      entry: { date: '2026-08-11' }
    })
    expect(firstCompletion.entry.completedAt).toBe('2026-08-11T01:00:00.000Z')

    await expect(application.completeToday()).resolves.toMatchObject({
      celebrated: false,
      recipePrompt: null,
      entry: { completedAt: '2026-08-11T01:00:00.000Z' }
    })
    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      editable: true,
      selectedEntry: { completedAt: '2026-08-11T01:00:00.000Z' }
    })
  })

  test('a Habit Recipe can be created after writing, disabled, and restored from Settings', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()

    await expect(
      application.saveHabitRecipe({ anchor: 'I close my laptop', enabled: true })
    ).resolves.toMatchObject({
      anchor: 'I close my laptop',
      enabled: true,
      sentence: 'After I close my laptop, I will write one honest sentence.'
    })
    await expect(application.setHabitRecipeEnabled(false)).resolves.toMatchObject({
      enabled: false
    })

    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      habitRecipe: {
        anchor: 'I close my laptop',
        enabled: false,
        sentence: 'After I close my laptop, I will write one honest sentence.'
      }
    })
  })

  test('the third non-consecutive completed entry asks once whether the anchor works', async () => {
    const dataDirectory = await makeDataDirectory()
    let today = '2026-08-01'
    const application = makeApplication(dataDirectory, undefined, {
      now: () => new Date(`${today}T09:00:00.000Z`),
      today: () => today
    })
    await application.startWriting()

    await application.saveEntry({ date: today, title: '', content: firstSentence })
    await application.completeToday()
    await application.saveHabitRecipe({ anchor: 'I finish dinner', enabled: true })

    today = '2026-08-05'
    await application.saveEntry({ date: today, title: '', content: firstSentence })
    await expect(application.completeToday()).resolves.toMatchObject({ recipePrompt: null })

    today = '2026-08-11'
    await application.saveEntry({ date: today, title: '', content: firstSentence })
    await expect(application.completeToday()).resolves.toMatchObject({ recipePrompt: 'review' })
    await expect(application.completeToday()).resolves.toMatchObject({ recipePrompt: null })
  })

  test('Not now dismisses the first Habit Recipe invitation without blocking later creation', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.dismissHabitRecipeInvite()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })

    await expect(application.completeToday()).resolves.toMatchObject({ recipePrompt: null })
    await expect(
      application.saveHabitRecipe({ anchor: 'I make morning coffee', enabled: true })
    ).resolves.toMatchObject({ enabled: true })
  })

  test('a confirmed 6-digit PIN locks private state after restart and unlocks locally', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })

    await expect(
      application.configurePin({ pin: '123456', confirmation: '654321' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      application.configurePin({ pin: '123456', confirmation: '123456' })
    ).resolves.toEqual({ enabled: true })

    const restarted = makeApplication(dataDirectory)
    const locked = await restarted.bootstrap()
    expect(locked).toMatchObject({ access: 'locked', screen: 'lock', pinEnabled: true })
    expect(locked).not.toHaveProperty('selectedEntry')
    expect(locked).not.toHaveProperty('entryDates')
    expect(locked).not.toHaveProperty('habitRecipe')

    await expect(restarted.unlock('000000')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(restarted.unlock('123456')).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'journal',
      selectedEntry: { content: firstSentence }
    })
  })

  test('consecutive incorrect PINs add an increasing delay without erasing the Journal Vault', async () => {
    const dataDirectory = await makeDataDirectory()
    let now = new Date('2026-08-11T09:00:00.000Z')
    const clock = { now: () => now, today: () => '2026-08-11' }
    const application = makeApplication(dataDirectory, undefined, clock)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })
    await application.configurePin({ pin: '123456', confirmation: '123456' })

    const restarted = makeApplication(dataDirectory, undefined, clock)
    await expect(restarted.unlock('000000')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(restarted.unlock('000000')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(restarted.unlock('123456')).rejects.toMatchObject({
      code: 'PIN_RETRY_DELAY',
      retryAfterMs: 1_000
    })

    now = new Date(now.getTime() + 1_000)
    await expect(restarted.unlock('123456')).resolves.toMatchObject({
      selectedEntry: { content: firstSentence }
    })
  })

  test('changing or disabling PIN Lock requires the current PIN', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.configurePin({ pin: '123456', confirmation: '123456' })

    await expect(
      application.configurePin({ pin: '654321', confirmation: '654321' })
    ).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(
      application.configurePin({
        currentPin: '123456',
        pin: '654321',
        confirmation: '654321'
      })
    ).resolves.toEqual({ enabled: true })

    await application.lock()
    await expect(application.unlock('123456')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await application.unlock('654321')
    await expect(application.disablePin('654321')).resolves.toEqual({ enabled: false })
    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      access: 'unlocked',
      pinEnabled: false
    })
  })

  test('forgotten PIN clearing requires the full destructive confirmation phrase', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })
    await application.configurePin({ pin: '123456', confirmation: '123456' })

    const restarted = makeApplication(dataDirectory)
    await expect(restarted.clearForgottenPin('delete')).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await expect(restarted.clearForgottenPin('DELETE MY JOURNAL VAULT')).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'welcome',
      entryDates: [],
      pinEnabled: false
    })
  })

  test('forgotten PIN clearing is unavailable while the PIN-protected vault is unlocked', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: '', content: firstSentence })
    await application.configurePin({ pin: '123456', confirmation: '123456' })

    await expect(application.clearForgottenPin('DELETE MY JOURNAL VAULT')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Forgotten PIN erasure is available only while InkPrompts Journal is locked.'
    })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { content: firstSentence },
      pinEnabled: true
    })

    await application.lock()
    await expect(application.clearForgottenPin('DELETE MY JOURNAL VAULT')).resolves.toMatchObject({
      screen: 'welcome',
      entryDates: [],
      pinEnabled: false
    })
  })

  test('forgotten PIN clearing also resets the in-memory retry delay', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.configurePin({ pin: '123456', confirmation: '123456' })
    await application.lock()
    await expect(application.unlock('000000')).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(application.unlock('000000')).rejects.toMatchObject({ code: 'INVALID_PIN' })

    await application.clearForgottenPin('DELETE MY JOURNAL VAULT')
    await application.startWriting()
    await application.configurePin({ pin: '654321', confirmation: '654321' })
    await application.lock()

    await expect(application.unlock('654321')).resolves.toMatchObject({
      access: 'unlocked',
      pinEnabled: true
    })
  })

  test('Settings erasure verifies ERASE and the current PIN before removing managed data', async () => {
    const dataDirectory = await makeDataDirectory()
    const externalDirectory = await makeDataDirectory()
    const externalBackup = join(externalDirectory, 'kept.inkbackup')
    await writeFile(externalBackup, 'user-managed-copy')
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: 'Private', content: firstSentence })
    await application.configurePin({ pin: '123456', confirmation: '123456' })

    await expect(
      application.eraseJournalVault({ confirmation: 'erase', pin: '123456' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      application.eraseJournalVault({ confirmation: 'ERASE', pin: '000000' })
    ).rejects.toMatchObject({ code: 'INVALID_PIN' })
    await expect(
      application.eraseJournalVault({ confirmation: 'ERASE', pin: '123456' })
    ).resolves.toMatchObject({ access: 'unlocked', screen: 'welcome', pinEnabled: false })

    await expectManagedVaultAbsent(dataDirectory)
    await expect(readFile(externalBackup, 'utf8')).resolves.toBe('user-managed-copy')
  })

  test('a failed erasure marker write deletes nothing', async () => {
    const dataDirectory = await makeDataDirectory()
    let failMarker = false
    const application = makeApplication(dataDirectory, {
      async write(path, data) {
        if (failMarker && path.endsWith('journal-erasure.pending')) {
          throw new Error('simulated marker failure')
        }
        await writeFile(path, data, { mode: 0o600 })
      }
    })
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: 'Still here', content: firstSentence })
    await application.configurePin({ pin: '123456', confirmation: '123456' })
    failMarker = true

    await expect(
      application.eraseJournalVault({ confirmation: 'ERASE', pin: '123456' })
    ).rejects.toMatchObject({
      code: 'ERASURE_NOT_STARTED',
      message: 'Journal Vault Erasure could not start. No App-managed journal data was deleted.'
    })
    await expect(readFile(join(dataDirectory, 'journal.key'))).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(join(dataDirectory, 'journal.vault'))).resolves.toBeInstanceOf(Buffer)
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { title: 'Still here' }
    })
  })

  test.each(['journal.key', 'journal.vault', 'snapshots', 'journal-erasure.pending'])(
    'an interrupted erasure at %s stays closed and resumes idempotently on restart',
    async (failedRemoval) => {
      const dataDirectory = await makeDataDirectory()
      let failRemoval = true
      const fileOperations = {
        async exists(path: string) {
          try {
            await access(path)
            return true
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
            throw error
          }
        },
        async remove(path: string, options?: { recursive?: boolean }) {
          if (failRemoval && path.endsWith(failedRemoval)) {
            throw new Error(`simulated ${failedRemoval} removal failure`)
          }
          await rm(path, { force: true, ...(options?.recursive ? { recursive: true } : {}) })
        }
      }
      const application = makeApplication(
        dataDirectory,
        undefined,
        undefined,
        undefined,
        fileOperations
      )
      await application.startWriting()
      await application.saveEntry({ date: '2026-08-11', title: 'Erase me', content: firstSentence })

      await expect(application.eraseJournalVault({ confirmation: 'ERASE' })).rejects.toMatchObject({
        code: 'SAVE_FAILED'
      })
      await expect(access(join(dataDirectory, 'journal-erasure.pending'))).resolves.toBeUndefined()
      await expect(application.bootstrap()).rejects.toMatchObject({ code: 'SAVE_FAILED' })

      failRemoval = false
      await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
        access: 'unlocked',
        screen: 'welcome'
      })
      await expectManagedVaultAbsent(dataDirectory)
      await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
        screen: 'welcome'
      })
    }
  )

  test('Journal History lists every saved Daily Entry newest-first without inventing statistics', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Today',
      content: firstSentence
    })
    await application.saveEntry({
      date: '2026-08-10',
      title: 'Clear this',
      content: searchableSentence
    })
    await application.saveEntry({
      date: '2026-08-10',
      title: '',
      content: emptyRichTextDocument()
    })
    await application.saveEntry({
      date: '2026-07-01',
      title: 'Title only',
      content: emptyRichTextDocument()
    })
    await application.saveEntry({
      date: '2025-12-31',
      title: '',
      content: searchableSentence
    })

    await expect(application.listJournalHistory()).resolves.toEqual([
      {
        date: '2026-08-11',
        title: 'Today',
        snippet: 'Today I chose to begin again.',
        empty: false
      },
      { date: '2026-08-10', title: null, snippet: '', empty: true },
      { date: '2026-07-01', title: 'Title only', snippet: '', empty: false },
      {
        date: '2025-12-31',
        title: null,
        snippet: 'Morning coffee made the apartment feel quiet.',
        empty: false
      }
    ])

    await application.configurePin({ pin: '123456', confirmation: '123456' })
    await application.lock()
    await expect(application.listJournalHistory()).rejects.toMatchObject({ code: 'LOCKED' })
  })

  test('local search returns stable minimal results for title and rich-text body matches', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-10',
      title: 'A quiet morning',
      content: searchableSentence
    })
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Remembering',
      content: firstSentence
    })

    const titleResults = await application.search('MORN')
    expect(titleResults).toEqual([
      {
        date: '2026-08-10',
        title: 'A quiet morning',
        snippet: 'Morning coffee made the apartment feel quiet.',
        titleMatches: [{ start: 8, end: 12 }],
        snippetMatches: [{ start: 0, end: 4 }]
      }
    ])
    expect(titleResults[0]).not.toHaveProperty('content')
    await expect(application.search('coffee!')).resolves.toMatchObject([{ date: '2026-08-10' }])
    await expect(application.search('')).resolves.toEqual([])

    await application.saveEntry({
      date: '2026-08-09',
      title: '',
      content: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `${'Earlier context. '.repeat(20)}Needle memory.` }]
          }
        ]
      }
    })
    await expect(application.search('needle')).resolves.toMatchObject([
      { date: '2026-08-09', snippet: expect.stringContaining('Needle memory') }
    ])

    await application.configurePin({ pin: '123456', confirmation: '123456' })
    await application.lock()
    await expect(application.search('morning')).rejects.toMatchObject({ code: 'LOCKED' })
  })

  test('search returns every match range against the original title and snippet text', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Résumé résumé',
      content: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Cafe\u0301 and CAFÉ stay <script>literal</script>.' }]
          }
        ]
      }
    })

    await expect(application.search('RESUME')).resolves.toEqual([
      {
        date: '2026-08-11',
        title: 'Résumé résumé',
        snippet: 'Cafe\u0301 and CAFÉ stay <script>literal</script>.',
        titleMatches: [
          { start: 0, end: 6 },
          { start: 7, end: 13 }
        ],
        snippetMatches: []
      }
    ])
    await expect(application.search('cafe')).resolves.toMatchObject([
      {
        snippet: 'Cafe\u0301 and CAFÉ stay <script>literal</script>.',
        titleMatches: [],
        snippetMatches: [
          { start: 0, end: 5 },
          { start: 10, end: 14 }
        ]
      }
    ])

    await application.saveEntry({
      date: '2026-08-10',
      title: 'Quiet morning notes',
      content: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `${'Quiet context without the full phrase. '.repeat(8)}A quiet---morning arrived. Quiet context.`
              }
            ]
          }
        ]
      }
    })
    await expect(application.search('quiet morning')).resolves.toEqual([
      {
        date: '2026-08-10',
        title: 'Quiet morning notes',
        snippet: expect.stringContaining('A quiet---morning arrived.'),
        titleMatches: [{ start: 0, end: 13 }],
        snippetMatches: [
          expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) })
        ]
      }
    ])
  })

  test('Device Snapshots deduplicate daily saves and recover an explicitly deleted entry', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: 'First', content: firstSentence })
    await application.saveEntry({ date: '2026-08-11', title: 'Updated', content: firstSentence })

    const dailySnapshots = await application.listDeviceSnapshots()
    expect(dailySnapshots).toHaveLength(1)
    expect(dailySnapshots[0]).toMatchObject({ reason: 'daily', deviceBound: true })
    expect(dailySnapshots[0]).not.toHaveProperty('content')

    await expect(application.deleteEntry('2026-08-11')).resolves.toMatchObject({
      deletedDate: '2026-08-11',
      entryDates: []
    })
    const snapshotsAfterDelete = await application.listDeviceSnapshots()
    const beforeDelete = snapshotsAfterDelete.find(
      (snapshot) => snapshot.reason === 'before-delete'
    )
    expect(beforeDelete).toBeDefined()

    const preparation = await application.prepareDeviceSnapshotRestore(beforeDelete!.id)
    expect(preparation).toMatchObject({ status: 'ready' })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: null
    })
    await expect(application.commitDeviceSnapshotRestore(preparation.token)).resolves.toMatchObject(
      {
        selectedEntry: { date: '2026-08-11', title: 'Updated' },
        entryDates: ['2026-08-11']
      }
    )
    await expect(application.listDeviceSnapshots()).resolves.toHaveLength(3)
  })

  test('a Portable Backup restores the full journal on a clean device without the original key', async () => {
    const sourceDirectory = await makeDataDirectory()
    let portableBackup: Buffer | undefined
    const source = makeApplication(sourceDirectory, undefined, undefined, {
      async savePortableBackup(_suggestedName, data) {
        portableBackup = data
        return true
      },
      async openPortableBackup() {
        return null
      }
    })
    await source.startWriting()
    await source.saveEntry({ date: '2026-08-11', title: 'Portable', content: firstSentence })
    await source.completeToday()
    await source.saveHabitRecipe({ anchor: 'I close my laptop', enabled: true })
    await source.updatePreferences({ theme: 'dark', spellcheck: false, idleLockMinutes: null })

    await expect(
      source.createPortableBackup({
        password: 'independent backup password',
        confirmation: 'independent backup password'
      })
    ).resolves.toMatchObject({ status: 'saved' })
    expect(portableBackup).toBeInstanceOf(Buffer)

    const destination = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return portableBackup!
      }
    })
    const preparation = await destination.preparePortableBackupRestore({
      password: 'independent backup password'
    })
    expect(preparation).toMatchObject({ status: 'ready' })
    await expect(destination.bootstrap()).resolves.toMatchObject({ screen: 'welcome' })
    await expect(destination.commitPortableBackupRestore(preparation.token)).resolves.toMatchObject(
      {
        status: 'restored',
        pinReviewRequired: true,
        view: {
          selectedEntry: { title: 'Portable', completedAt: '2026-08-11T01:00:00.000Z' },
          habitRecipe: { anchor: 'I close my laptop', enabled: true },
          preferences: { theme: 'dark', spellcheck: false },
          pinEnabled: false
        }
      }
    )
    await expect(destination.search('portable')).resolves.toMatchObject([{ date: '2026-08-11' }])
  })

  test('a valid Portable Backup can replace a PIN-locked local vault without exposing it', async () => {
    let portableBackup: Buffer | undefined
    const source = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup(_suggestedName, data) {
        portableBackup = Buffer.from(data)
        return true
      },
      async openPortableBackup() {
        return null
      }
    })
    await source.startWriting()
    await source.saveEntry({
      date: '2026-08-11',
      title: 'Recovered backup',
      content: firstSentence
    })
    await source.createPortableBackup({
      password: 'independent recovery password',
      confirmation: 'independent recovery password'
    })

    const destinationDirectory = await makeDataDirectory()
    const fileDialogs = {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return portableBackup!
      }
    }
    const destination = makeApplication(destinationDirectory, undefined, undefined, fileDialogs)
    await destination.startWriting()
    await destination.saveEntry({
      date: '2026-08-11',
      title: 'Locked local entry',
      content: firstSentence
    })
    await destination.configurePin({ pin: '123456', confirmation: '123456' })

    const restarted = makeApplication(destinationDirectory, undefined, undefined, fileDialogs)
    await expect(restarted.bootstrap()).resolves.toMatchObject({ access: 'locked' })
    await expect(
      restarted.restorePortableBackup({ password: 'independent recovery password' })
    ).resolves.toMatchObject({
      status: 'restored',
      view: {
        access: 'unlocked',
        selectedEntry: { title: 'Recovered backup' },
        pinEnabled: false,
        pinReviewRequired: true
      }
    })
    await expect(restarted.search('locked local entry')).resolves.toEqual([])
    await expect(restarted.listDeviceSnapshots()).resolves.toEqual([])
  })

  test('Markdown, TXT, and JSON exports preserve supported content in chronological order', async () => {
    const exported = new Map<string, string>()
    const application = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return null
      },
      async saveExport(suggestedName, data) {
        exported.set(suggestedName, data)
        return true
      }
    })
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Formatted',
      content: formattedDocument
    })
    await application.saveEntry({ date: '2026-08-10', title: '', content: firstSentence })

    await expect(
      application.exportJournal({ format: 'markdown', unencryptedConfirmed: true })
    ).resolves.toMatchObject({ status: 'saved' })
    await expect(
      application.exportJournal({ format: 'txt', unencryptedConfirmed: true })
    ).resolves.toMatchObject({ status: 'saved' })
    await expect(
      application.exportJournal({ format: 'json', unencryptedConfirmed: true })
    ).resolves.toMatchObject({ status: 'saved' })

    const markdown = exported.get('InkPrompts-Journal-2026-08-11.md')!
    expect(markdown.indexOf('2026-08-10')).toBeLessThan(markdown.indexOf('2026-08-11'))
    expect(markdown).toContain('**Bold**')
    expect(markdown).toContain('_italic_')
    expect(markdown).toContain('[a link](https://example.com)')
    expect(markdown).toContain('- Tea')
    expect(markdown).toContain('1. Write')
    expect(markdown).toContain('> Enough.')

    const text = exported.get('InkPrompts-Journal-2026-08-11.txt')!
    expect(text).toContain('Bold and italic with a link')
    expect(text).not.toContain('**Bold**')

    const json = JSON.parse(exported.get('InkPrompts-Journal-2026-08-11.json')!)
    expect(json).toMatchObject({ format: 'inkprompts-journal-export', version: 1 })
    expect(json.entries.map((entry: { date: string }) => entry.date)).toEqual([
      '2026-08-10',
      '2026-08-11'
    ])
    expect(json).not.toHaveProperty('habitRecipe')
    expect(json).not.toHaveProperty('pinLock')
  })

  test('opening the previous schema migrates it atomically without losing journal behavior', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Before upgrade',
      content: firstSentence
    })
    await application.completeToday()
    await application.saveHabitRecipe({ anchor: 'I close my laptop', enabled: true })
    await application.updatePreferences({ theme: 'dark', spellcheck: false, idleLockMinutes: null })

    const protectedKey = await readFile(join(dataDirectory, 'journal.key'), 'utf8')
    const key = keyProtector.unprotect(protectedKey)
    const vaultPath = join(dataDirectory, 'journal.vault')
    const legacyState = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    legacyState.schemaVersion = 1
    await writeFile(vaultPath, encryptEnvelope(JSON.stringify(legacyState), key))

    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      selectedEntry: { title: 'Before upgrade', completedAt: '2026-08-11T01:00:00.000Z' },
      habitRecipe: { anchor: 'I close my laptop' },
      preferences: { theme: 'dark', spellcheck: false }
    })
    const migrated = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    expect(migrated.schemaVersion).toBe(2)
  })

  test('a newer unsupported schema fails fast without changing the original vault', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'From the future',
      content: firstSentence
    })

    const protectedKey = await readFile(join(dataDirectory, 'journal.key'), 'utf8')
    const key = keyProtector.unprotect(protectedKey)
    const vaultPath = join(dataDirectory, 'journal.vault')
    const futureState = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    futureState.schemaVersion = 99
    const futureVault = encryptEnvelope(JSON.stringify(futureState), key)
    await writeFile(vaultPath, futureVault)

    await expect(makeApplication(dataDirectory).bootstrap()).rejects.toMatchObject({
      code: 'VAULT_UNSUPPORTED'
    })
    await expect(readFile(vaultPath, 'utf8')).resolves.toBe(futureVault)
  })

  test('a failed schema migration leaves the previous vault intact', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Before failed migration',
      content: firstSentence
    })

    const protectedKey = await readFile(join(dataDirectory, 'journal.key'), 'utf8')
    const key = keyProtector.unprotect(protectedKey)
    const vaultPath = join(dataDirectory, 'journal.vault')
    const legacyState = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    legacyState.schemaVersion = 1
    const legacyVault = encryptEnvelope(JSON.stringify(legacyState), key)
    await writeFile(vaultPath, legacyVault)

    const failingWriter = {
      async write(path: string, data: string): Promise<void> {
        if (path === vaultPath) throw new Error('simulated migration write failure')
        await writeFile(path, data)
      }
    }

    await expect(makeApplication(dataDirectory, failingWriter).bootstrap()).rejects.toMatchObject({
      code: 'SAVE_FAILED'
    })
    await expect(readFile(vaultPath, 'utf8')).resolves.toBe(legacyVault)
  })

  test('Device Snapshot retention deterministically keeps only the newest 30 copies', async () => {
    let today = '2026-01-01'
    const application = makeApplication(await makeDataDirectory(), undefined, {
      now: () => new Date(`${today}T12:00:00.000Z`),
      today: () => today
    })
    await application.startWriting()
    for (let day = 1; day <= 31; day += 1) {
      today = `2026-01-${String(day).padStart(2, '0')}`
      await application.saveEntry({ date: today, title: `Day ${day}`, content: firstSentence })
    }

    const snapshots = await application.listDeviceSnapshots()
    expect(snapshots).toHaveLength(30)
    expect(snapshots.at(-1)?.createdAt).toBe('2026-01-02T12:00:00.000Z')
    expect(snapshots[0].createdAt).toBe('2026-01-31T12:00:00.000Z')
  })

  test('the oldest listed Device Snapshot remains restorable at the 30-copy limit', async () => {
    let today = '2026-01-01'
    const application = makeApplication(await makeDataDirectory(), undefined, {
      now: () => new Date(`${today}T12:00:00.000Z`),
      today: () => today
    })
    await application.startWriting()
    for (let day = 1; day <= 30; day += 1) {
      today = `2026-01-${String(day).padStart(2, '0')}`
      await application.saveEntry({ date: today, title: `Day ${day}`, content: firstSentence })
    }

    const snapshots = await application.listDeviceSnapshots()
    expect(snapshots).toHaveLength(30)
    await expect(application.restoreDeviceSnapshot(snapshots.at(-1)!.id)).resolves.toMatchObject({
      access: 'unlocked',
      screen: 'journal'
    })
  })

  test('a damaged Device Snapshot cannot overwrite the current Journal Vault', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: 'Current', content: firstSentence })
    await application.deleteEntry('2026-08-11')
    const beforeDelete = (await application.listDeviceSnapshots()).find(
      (snapshot) => snapshot.reason === 'before-delete'
    )!
    const snapshotPath = join(dataDirectory, 'snapshots', `${beforeDelete.id}.vault`)
    await writeFile(snapshotPath, 'truncated')

    await expect(application.restoreDeviceSnapshot(beforeDelete.id)).rejects.toMatchObject({
      code: 'VAULT_CORRUPT'
    })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: null,
      entryDates: []
    })
    await expect(readFile(snapshotPath, 'utf8')).resolves.toBe('truncated')
  })

  test('a prepared Device Snapshot remains retryable when replacement fails', async () => {
    const dataDirectory = await makeDataDirectory()
    let failVaultWrite = false
    const application = makeApplication(dataDirectory, {
      async write(path, data) {
        if (failVaultWrite && path.endsWith('journal.vault')) throw new Error('disk full')
        await writeFile(path, data, { mode: 0o600 })
      }
    })
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Snapshot source',
      content: firstSentence
    })
    await application.deleteEntry('2026-08-11')
    const snapshot = (await application.listDeviceSnapshots()).find(
      (candidate) => candidate.reason === 'before-delete'
    )!
    const preparation = await application.prepareDeviceSnapshotRestore(snapshot.id)

    failVaultWrite = true
    await expect(application.commitDeviceSnapshotRestore(preparation.token)).rejects.toMatchObject({
      code: 'SAVE_FAILED'
    })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({ selectedEntry: null })
    failVaultWrite = false
    await expect(application.commitDeviceSnapshotRestore(preparation.token)).resolves.toMatchObject(
      {
        selectedEntry: { title: 'Snapshot source' }
      }
    )
  })

  test('wrong passwords and tampered Portable Backups preserve the current vault', async () => {
    let backup: Buffer | undefined
    const source = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup(_name, data) {
        backup = Buffer.from(data)
        return true
      },
      async openPortableBackup() {
        return null
      }
    })
    await source.startWriting()
    await source.saveEntry({ date: '2026-08-11', title: 'Backup source', content: firstSentence })
    await source.createPortableBackup({
      password: 'portable password',
      confirmation: 'portable password'
    })

    let openedBackup = backup!
    const destination = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return openedBackup
      }
    })
    await destination.startWriting()
    await destination.saveEntry({ date: '2026-08-11', title: 'Keep this', content: firstSentence })

    await expect(
      destination.restorePortableBackup({ password: 'wrong password' })
    ).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
      message: 'The backup password is incorrect, or this Portable Backup is damaged.'
    })
    openedBackup = Buffer.from(backup!)
    openedBackup[openedBackup.length - 8] ^= 1
    await expect(
      destination.restorePortableBackup({ password: 'portable password' })
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    await expect(destination.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { title: 'Keep this' }
    })
  })

  test('a validated Portable Backup does not replace local state until commit succeeds', async () => {
    const backupState = {
      schemaVersion: 2,
      onboarded: true,
      entries: {
        '2026-08-11': {
          date: '2026-08-11',
          title: 'Prepared backup',
          content: firstSentence,
          createdAt: '2026-08-11T01:00:00.000Z',
          updatedAt: '2026-08-11T01:00:00.000Z',
          completedAt: null
        }
      },
      preferences: { theme: 'system', spellcheck: true, idleLockMinutes: null },
      habitRecipe: null,
      habitRecipeInviteDismissed: false,
      habitRecipeReviewAsked: false,
      pinLock: null,
      lastDailySnapshotDate: null,
      pinReviewRequired: false
    }
    const backup = encryptPortableBackup(JSON.stringify(backupState), 'portable password')
    let failVaultWrite = false
    const application = makeApplication(
      await makeDataDirectory(),
      {
        async write(path, data) {
          if (failVaultWrite && path.endsWith('journal.vault')) throw new Error('disk full')
          await writeFile(path, data, { mode: 0o600 })
        }
      },
      undefined,
      {
        async savePortableBackup() {
          return false
        },
        async openPortableBackup() {
          return backup
        }
      }
    )
    await application.startWriting()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Local state',
      content: firstSentence
    })
    const preparation = await application.preparePortableBackupRestore({
      password: 'portable password'
    })
    if (preparation.status !== 'ready') throw new Error('Expected a validated backup')

    failVaultWrite = true
    await expect(application.commitPortableBackupRestore(preparation.token)).rejects.toMatchObject({
      code: 'SAVE_FAILED'
    })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { title: 'Local state' }
    })
    failVaultWrite = false
    await expect(application.commitPortableBackupRestore(preparation.token)).resolves.toMatchObject(
      {
        view: { selectedEntry: { title: 'Prepared backup' } }
      }
    )
  })

  test('distinguishes an unsupported backup schema from damaged authenticated content', async () => {
    const password = 'portable password'
    const unsupported = encryptPortableBackup(JSON.stringify({ schemaVersion: 999 }), password)
    const damaged = encryptPortableBackup('not a Journal Vault', password)
    let openedBackup = unsupported
    const destinationDirectory = await makeDataDirectory()
    const destination = makeApplication(destinationDirectory, undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return openedBackup
      }
    })

    await expect(destination.restorePortableBackup({ password })).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
      message: 'This Portable Backup was created by an unsupported version.'
    })
    expect(openedBackup.equals(unsupported)).toBe(true)

    openedBackup = damaged
    await expect(destination.restorePortableBackup({ password })).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
      message: 'This Portable Backup is damaged and was not restored.'
    })
    expect(openedBackup.equals(damaged)).toBe(true)

    openedBackup = Buffer.from('{}')
    await expect(destination.restorePortableBackup({ password })).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
      message: 'This Portable Backup is damaged and was not restored.'
    })

    openedBackup = Buffer.from(JSON.stringify({ format: 'inkprompts-portable-backup', version: 2 }))
    await expect(destination.restorePortableBackup({ password })).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
      message: 'This Portable Backup was created by an unsupported version.'
    })
    await expectManagedVaultAbsent(destinationDirectory)
  })

  test('Portable Backup restore is serialized after an in-flight durable save', async () => {
    let backup: Buffer | undefined
    const source = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup(_name, data) {
        backup = Buffer.from(data)
        return true
      },
      async openPortableBackup() {
        return null
      }
    })
    await source.startWriting()
    await source.saveEntry({ date: '2026-08-11', title: 'Backup wins', content: firstSentence })
    await source.createPortableBackup({
      password: 'serialized restore password',
      confirmation: 'serialized restore password'
    })

    let blockNextVaultWrite = false
    let vaultWriteInFlight = false
    let releaseWrite = (): void => undefined
    let reportBlocked = (): void => undefined
    let reportConcurrentWrite = (): void => undefined
    const blocked = new Promise<void>((resolve) => {
      reportBlocked = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const concurrentWrite = new Promise<void>((resolve) => {
      reportConcurrentWrite = resolve
    })
    const destination = makeApplication(
      await makeDataDirectory(),
      {
        async write(path, data) {
          if (blockNextVaultWrite && path.endsWith('journal.vault')) {
            blockNextVaultWrite = false
            vaultWriteInFlight = true
            reportBlocked()
            await release
            vaultWriteInFlight = false
          } else if (vaultWriteInFlight && path.endsWith('journal.vault')) {
            reportConcurrentWrite()
          }
          await writeFile(path, data)
        }
      },
      undefined,
      {
        async savePortableBackup() {
          return false
        },
        async openPortableBackup() {
          return backup!
        }
      }
    )
    await destination.startWriting()
    blockNextVaultWrite = true
    const saving = destination.saveEntry({
      date: '2026-08-11',
      title: 'Queued local edit',
      content: searchableSentence
    })
    await blocked
    const restoring = destination.restorePortableBackup({ password: 'serialized restore password' })
    const wroteConcurrently = await Promise.race([
      concurrentWrite.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))
    ])
    releaseWrite()
    await Promise.all([saving, restoring])

    expect(wroteConcurrently).toBe(false)
    await expect(destination.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { title: 'Backup wins' }
    })
  })

  test('cancelled and failed ordinary exports leave the Journal Vault unchanged', async () => {
    let shouldFail = false
    const application = makeApplication(await makeDataDirectory(), undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return null
      },
      async saveExport() {
        if (shouldFail) throw new Error('disk path must stay private')
        return false
      }
    })
    await application.startWriting()
    await application.saveEntry({ date: '2026-08-11', title: 'Keep me', content: firstSentence })

    await expect(
      application.exportJournal({ format: 'json', unencryptedConfirmed: true })
    ).resolves.toEqual({ status: 'cancelled' })
    shouldFail = true
    await expect(
      application.exportJournal({ format: 'json', unencryptedConfirmed: true })
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' })
    await expect(application.openDate('2026-08-11')).resolves.toMatchObject({
      selectedEntry: { title: 'Keep me' }
    })
  })

  test('ten years of daily writing stays responsive through open, search, save, and export', async () => {
    const dataDirectory = await makeDataDirectory()
    const initializer = makeApplication(dataDirectory)
    await initializer.startWriting()
    const protectedKey = await readFile(join(dataDirectory, 'journal.key'), 'utf8')
    const key = keyProtector.unprotect(protectedKey)
    const vaultPath = join(dataDirectory, 'journal.vault')
    const state = JSON.parse(decryptEnvelope(await readFile(vaultPath, 'utf8'), key))
    const start = new Date('2016-08-11T00:00:00.000Z')
    const end = new Date('2026-08-11T00:00:00.000Z')
    for (let value = start; value <= end; value = new Date(value.getTime() + 86_400_000)) {
      const date = value.toISOString().slice(0, 10)
      state.entries[date] = {
        date,
        title: `Memory ${date}`,
        content: firstSentence,
        createdAt: `${date}T12:00:00.000Z`,
        updatedAt: `${date}T12:00:00.000Z`,
        completedAt: null
      }
    }
    await writeFile(vaultPath, encryptEnvelope(JSON.stringify(state), key))

    let exported = ''
    const application = makeApplication(dataDirectory, undefined, undefined, {
      async savePortableBackup() {
        return false
      },
      async openPortableBackup() {
        return null
      },
      async saveExport(_name, data) {
        exported = data
        return true
      }
    })

    const openStarted = performance.now()
    await application.bootstrap()
    expect(performance.now() - openStarted).toBeLessThan(2_000)

    const searchStarted = performance.now()
    await expect(application.search('2018-03-04')).resolves.toMatchObject([{ date: '2018-03-04' }])
    expect(performance.now() - searchStarted).toBeLessThan(750)

    const historyStarted = performance.now()
    const history = await application.listJournalHistory()
    expect(history.length).toBeGreaterThan(3_650)
    expect(performance.now() - historyStarted).toBeLessThan(750)

    const saveStarted = performance.now()
    await application.saveEntry({
      date: '2026-08-11',
      title: 'Updated today',
      content: firstSentence
    })
    expect(performance.now() - saveStarted).toBeLessThan(2_000)

    const exportStarted = performance.now()
    await application.exportJournal({ format: 'json', unencryptedConfirmed: true })
    expect(performance.now() - exportStarted).toBeLessThan(2_000)
    expect(exported).toContain('Memory 2016-08-11')
  }, 15_000)

  test('blank new dates stay absent while clearing an existing entry keeps its record', async () => {
    const application = makeApplication(await makeDataDirectory())
    await application.startWriting()
    const blank = emptyDocument()
    await expect(
      application.saveEntry({ date: '2026-08-10', title: '   ', content: blank })
    ).resolves.toMatchObject({ entry: null, entryDates: [] })
    await application.saveEntry({ date: '2026-08-10', title: 'Title only', content: blank })
    await expect(
      application.saveEntry({ date: '2026-08-10', title: '', content: blank })
    ).resolves.toMatchObject({
      entry: { date: '2026-08-10', title: '', content: blank },
      entryDates: ['2026-08-10']
    })
  })

  test('rapid saves are serialized and restart at the final acknowledged content', async () => {
    const dataDirectory = await makeDataDirectory()
    const application = makeApplication(dataDirectory)
    await application.startWriting()
    const first = application.saveEntry({
      date: '2026-08-11',
      title: 'First queued edit',
      content: firstSentence
    })
    const second = application.saveEntry({
      date: '2026-08-11',
      title: 'Final queued edit',
      content: searchableSentence
    })
    await Promise.all([first, second])

    await expect(makeApplication(dataDirectory).bootstrap()).resolves.toMatchObject({
      selectedEntry: { title: 'Final queued edit', content: searchableSentence }
    })
  })
})

function emptyDocument(): RichTextDocument {
  return {
    type: 'doc' as const,
    version: 1 as const,
    content: [{ type: 'paragraph' as const }]
  }
}
