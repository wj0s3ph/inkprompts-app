import {
  assertRichTextDocument,
  richTextToPlainText,
  type CompleteTodayResult,
  type DailyEntry,
  type SaveEntryInput,
  type SaveEntryResult
} from '../../shared/journal-contract'
import { JournalError } from '../journal-error'
import type { JournalVaultState } from '../storage/journal-vault-repository'
import {
  assertEditableDate,
  assertLocalDate,
  buildLockView,
  buildView,
  entryDates
} from './journal-application-view'
import type { JournalApplication } from './journal-application-contract'
import type { JournalSession } from './journal-session'

type DailyEntryUseCases = Pick<
  JournalApplication,
  | 'bootstrap'
  | 'startWriting'
  | 'openDate'
  | 'listJournalHistory'
  | 'search'
  | 'deleteEntry'
  | 'completeToday'
  | 'saveEntry'
>

export function createDailyEntryUseCases(session: JournalSession): DailyEntryUseCases {
  return {
    async bootstrap() {
      const state = await session.getBootstrapState()
      if (state.pinLock && !session.isUnlocked()) return buildLockView(session.clock.today())
      return buildView(state, session.clock.today(), state.onboarded ? 'journal' : 'welcome')
    },

    async startWriting() {
      const today = session.clock.today()
      const state = await session.getState()
      session.assertUnlocked(state)
      if (state.onboarded) return buildView(state, today, 'journal')
      return session.commit((current) => {
        const candidate = { ...current, onboarded: true }
        return { state: candidate, result: buildView(candidate, today, 'journal') }
      })
    },

    async openDate(date: string) {
      assertLocalDate(date)
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      return buildView(state, session.clock.today(), 'journal', date)
    },

    async listJournalHistory() {
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      return Object.values(state.entries)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((entry) => {
          const plainText = richTextToPlainText(entry.content)
          const snippet = historySnippet(plainText)
          return {
            date: entry.date,
            title: entry.title || null,
            snippet,
            empty: !entry.title.trim() && !plainText
          }
        })
    },

    async search(query: string) {
      if (typeof query !== 'string' || query.length > 200) {
        throw new JournalError('INVALID_INPUT', 'Use a shorter search phrase.')
      }
      const state = await session.getSettledState()
      session.assertUnlocked(state)
      const normalizedQuery = normalizeForSearch(query)
      if (!normalizedQuery) return []

      return Object.values(state.entries)
        .filter((entry) => {
          const title = projectForSearch(entry.title).value
          const body = projectForSearch(richTextToPlainText(entry.content)).value
          return title.includes(normalizedQuery) || body.includes(normalizedQuery)
        })
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((entry) => {
          const title = entry.title || null
          const snippet = searchSnippet(richTextToPlainText(entry.content), normalizedQuery)
          return {
            date: entry.date,
            title,
            snippet,
            titleMatches: title ? findMatchRanges(title, normalizedQuery) : [],
            snippetMatches: findMatchRanges(snippet, normalizedQuery)
          }
        })
    },

    async deleteEntry(date: string) {
      assertEditableDate(date, session.clock.today())
      return session.commit((current) => {
        if (!current.entries[date]) {
          throw new JournalError('INVALID_INPUT', 'This Daily Entry no longer exists.')
        }
        const today = session.clock.today()
        const timestamp = session.clock.now().toISOString()
        const entries = { ...current.entries }
        delete entries[date]
        const needsDailySnapshot = current.lastDailySnapshotDate !== today
        const candidate = {
          ...current,
          entries,
          lastDailySnapshotDate: needsDailySnapshot ? today : current.lastDailySnapshotDate
        }
        return {
          state: candidate,
          result: { deletedDate: date, entryDates: entryDates(candidate) },
          beforeSave: async () => {
            if (needsDailySnapshot) {
              await session.repository.createDeviceSnapshot('daily', timestamp)
            }
            await session.repository.createDeviceSnapshot('before-delete', timestamp)
          }
        }
      })
    },

    async completeToday() {
      const today = session.clock.today()
      return session.commit<CompleteTodayResult>((current) => {
        const entry = current.entries[today]
        if (!entry || (!entry.title.trim() && !richTextToPlainText(entry.content))) {
          throw new JournalError(
            'INVALID_INPUT',
            "Done for Today is available after today's writing has been saved."
          )
        }
        if (entry.completedAt) {
          return {
            state: current,
            result: { celebrated: false, message: null, recipePrompt: null, entry }
          }
        }

        const completedEntry = { ...entry, completedAt: session.clock.now().toISOString() }
        const completedBefore = Object.values(current.entries).filter(
          (candidate) => candidate.completedAt !== null
        ).length
        const shouldInvite =
          completedBefore === 0 && !current.habitRecipe && !current.habitRecipeInviteDismissed
        const shouldReview =
          completedBefore === 2 && Boolean(current.habitRecipe) && !current.habitRecipeReviewAsked
        const candidate = {
          ...current,
          entries: { ...current.entries, [today]: completedEntry },
          habitRecipeReviewAsked: current.habitRecipeReviewAsked || shouldReview
        }
        return {
          state: candidate,
          result: {
            celebrated: true,
            message: 'Saved. One sentence counts.' as const,
            recipePrompt: shouldInvite
              ? ('invite' as const)
              : shouldReview
                ? ('review' as const)
                : null,
            entry: completedEntry
          }
        }
      })
    },

    async saveEntry(input: SaveEntryInput) {
      assertEditableDate(input.date, session.clock.today())
      if (typeof input.title !== 'string' || input.title.length > 10_000) {
        throw new JournalError('INVALID_INPUT', 'The optional title is too long.')
      }
      try {
        assertRichTextDocument(input.content)
      } catch {
        throw new JournalError('INVALID_INPUT', 'The Daily Entry contains unsupported content.')
      }

      return session.commit<SaveEntryResult>((current) => {
        const existing = current.entries[input.date]
        const containsWriting = Boolean(input.title.trim() || richTextToPlainText(input.content))
        if (!existing && !containsWriting) {
          return {
            state: current,
            result: { status: 'saved' as const, entry: null, entryDates: entryDates(current) }
          }
        }

        const timestamp = session.clock.now().toISOString()
        const today = session.clock.today()
        const changed =
          !existing ||
          existing.title !== input.title ||
          JSON.stringify(existing.content) !== JSON.stringify(input.content)
        const needsDailySnapshot = changed && current.lastDailySnapshotDate !== today
        const entry: DailyEntry = {
          date: input.date,
          title: input.title,
          content: structuredClone(input.content),
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
          completedAt: existing?.completedAt ?? null
        }
        const candidate: JournalVaultState = {
          ...current,
          onboarded: true,
          entries: { ...current.entries, [input.date]: entry },
          lastDailySnapshotDate: needsDailySnapshot ? today : current.lastDailySnapshotDate
        }
        return {
          state: candidate,
          result: { status: 'saved' as const, entry, entryDates: entryDates(candidate) },
          beforeSave: needsDailySnapshot
            ? () =>
                session.repository.createDeviceSnapshot('daily', timestamp).then(() => undefined)
            : undefined
        }
      })
    }
  }
}

function historySnippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= 240 ? compact : `${compact.slice(0, 239)}…`
}

function normalizeForSearch(value: string): string {
  return projectForSearch(value).value
}

function searchSnippet(value: string, normalizedQuery: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= 160) return compact

  const projection = projectForSearch(compact)
  const matchIndex = projection.value.indexOf(normalizedQuery)
  const sourceIndex = matchIndex < 0 ? 0 : projection.starts[matchIndex]
  const start = Math.max(0, sourceIndex - 60)
  const end = Math.min(compact.length, start + 160)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

interface SearchProjection {
  value: string
  starts: number[]
  ends: number[]
}

function projectForSearch(source: string): SearchProjection {
  const characters: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let sourceIndex = 0
  let separatorPending = false

  const append = (character: string, start: number, end: number): void => {
    characters.push(character)
    starts.push(start)
    ends.push(end)
  }

  for (const originalCharacter of source) {
    const start = sourceIndex
    sourceIndex += originalCharacter.length
    for (const normalizedCharacter of originalCharacter.normalize('NFKD').toLocaleLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(normalizedCharacter)) {
        if (separatorPending && characters.length > 0) append(' ', start, sourceIndex)
        separatorPending = false
        append(normalizedCharacter, start, sourceIndex)
      } else if (!/\p{M}/u.test(normalizedCharacter) && characters.length > 0) {
        separatorPending = true
      }
    }
  }

  return { value: characters.join(''), starts, ends }
}

function findMatchRanges(
  source: string,
  normalizedQuery: string
): Array<{
  start: number
  end: number
}> {
  const projection = projectForSearch(source)
  const ranges: Array<{ start: number; end: number }> = []
  const seen = new Set<string>()

  let offset = 0
  while (offset <= projection.value.length - normalizedQuery.length) {
    const matchIndex = projection.value.indexOf(normalizedQuery, offset)
    if (matchIndex < 0) break
    const start = projection.starts[matchIndex]
    const projectedEnd = projection.ends[matchIndex + normalizedQuery.length - 1]
    const end = extendOverCombiningMarks(source, projectedEnd)
    const key = `${start}:${end}`
    if (!seen.has(key)) {
      seen.add(key)
      ranges.push({ start, end })
    }
    offset = matchIndex + normalizedQuery.length
  }

  return ranges
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1)
      if (previous && range.start < previous.end) {
        previous.end = Math.max(previous.end, range.end)
      } else {
        merged.push({ ...range })
      }
      return merged
    }, [])
}

function extendOverCombiningMarks(source: string, initialEnd: number): number {
  let end = initialEnd
  while (end < source.length) {
    const nextCharacter = String.fromCodePoint(source.codePointAt(end)!)
    if (!/\p{M}/u.test(nextCharacter)) break
    end += nextCharacter.length
  }
  return end
}
