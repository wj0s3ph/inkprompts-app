import type { JournalApplication } from '../application/create-journal-application'
import { JournalError } from '../journal-error'

type JournalCommand = keyof JournalApplication
type RecordValue = Record<string, unknown>

const noArgumentCommands = new Set<JournalCommand>([
  'bootstrap',
  'startWriting',
  'listDeviceSnapshots',
  'lock',
  'dismissHabitRecipeInvite',
  'completeToday'
])

export function assertJournalIpcArguments(command: JournalCommand, args: readonly unknown[]): void {
  assertPayloadSize(args)
  if (noArgumentCommands.has(command)) {
    if (args.length !== 0) invalidShape()
    return
  }

  switch (command) {
    case 'openDate':
      assertStringArgument(args, 10)
      return
    case 'search':
      assertStringArgument(args, 200)
      return
    case 'deleteEntry':
      assertStringArgument(args, 10)
      return
    case 'restoreDeviceSnapshot':
      assertStringArgument(args, 300)
      return
    case 'disablePin':
    case 'unlock':
      assertStringArgument(args, 6)
      return
    case 'clearForgottenPin':
      assertStringArgument(args, 50)
      return
    case 'eraseJournalVault': {
      const input = assertObjectArgument(args, ['confirmation'], ['pin'])
      if (!isBoundedString(input.confirmation, 5)) invalidShape()
      if (input.pin !== undefined && !isBoundedString(input.pin, 6)) invalidShape()
      return
    }
    case 'setHabitRecipeEnabled':
      if (args.length !== 1 || typeof args[0] !== 'boolean') invalidShape()
      return
    case 'createPortableBackup': {
      const input = assertObjectArgument(args, ['password', 'confirmation'])
      assertBoundedStrings(input, ['password', 'confirmation'], 1_024)
      return
    }
    case 'restorePortableBackup': {
      const input = assertObjectArgument(args, ['password'])
      assertBoundedStrings(input, ['password'], 1_024)
      return
    }
    case 'exportJournal': {
      const input = assertObjectArgument(args, ['format', 'unencryptedConfirmed'])
      if (
        !['markdown', 'txt', 'json'].includes(input.format as string) ||
        input.unencryptedConfirmed !== true
      ) {
        invalidShape()
      }
      return
    }
    case 'configurePin': {
      const input = assertObjectArgument(args, ['pin', 'confirmation'], ['currentPin'])
      assertBoundedStrings(input, ['pin', 'confirmation'], 6)
      if (input.currentPin !== undefined && !isBoundedString(input.currentPin, 6)) invalidShape()
      return
    }
    case 'updatePreferences': {
      const input = assertObjectArgument(args, ['theme', 'spellcheck'])
      if (
        !['system', 'light', 'dark'].includes(input.theme as string) ||
        typeof input.spellcheck !== 'boolean'
      ) {
        invalidShape()
      }
      return
    }
    case 'saveHabitRecipe': {
      const input = assertObjectArgument(args, ['anchor', 'enabled'])
      if (!isBoundedString(input.anchor, 160) || typeof input.enabled !== 'boolean') invalidShape()
      return
    }
    case 'saveEntry': {
      const input = assertObjectArgument(args, ['date', 'title', 'content'])
      if (
        !isBoundedString(input.date, 10) ||
        !isBoundedString(input.title, 10_000) ||
        !isRecord(input.content)
      ) {
        invalidShape()
      }
      return
    }
    default:
      invalidShape()
  }
}

function assertPayloadSize(args: readonly unknown[]): void {
  let serialized: string
  try {
    serialized = JSON.stringify(args)
  } catch {
    invalidShape()
  }
  if (Buffer.byteLength(serialized!, 'utf8') > 2_100_000) invalidShape()
}

function assertStringArgument(args: readonly unknown[], maximumLength: number): void {
  if (args.length !== 1 || !isBoundedString(args[0], maximumLength)) invalidShape()
}

function assertObjectArgument(
  args: readonly unknown[],
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): RecordValue {
  if (args.length !== 1 || !isRecord(args[0])) invalidShape()
  const value = args[0] as RecordValue
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    invalidShape()
  }
  return value
}

function assertBoundedStrings(
  value: RecordValue,
  keys: readonly string[],
  maximumLength: number
): void {
  if (keys.some((key) => !isBoundedString(value[key], maximumLength))) invalidShape()
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidShape(): never {
  throw new JournalError('INVALID_INPUT', 'The renderer request had an invalid shape.')
}
