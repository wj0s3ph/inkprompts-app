import { formatHabitRecipeSentence } from '../../shared/habit-recipe'
import type { HabitRecipe, JournalPreferences } from '../../shared/journal-contract'
import { JournalError } from '../journal-error'
import type { JournalApplication } from './journal-application-contract'
import type { JournalSession } from './journal-session'

type HabitPreferenceUseCases = Pick<
  JournalApplication,
  'updatePreferences' | 'saveHabitRecipe' | 'dismissHabitRecipeInvite' | 'setHabitRecipeEnabled'
>

export function createHabitPreferenceUseCases(session: JournalSession): HabitPreferenceUseCases {
  return {
    async updatePreferences(preferences: JournalPreferences) {
      if (
        !['system', 'light', 'dark'].includes(preferences.theme) ||
        typeof preferences.spellcheck !== 'boolean'
      ) {
        throw new JournalError('INVALID_INPUT', 'Choose a valid theme and spellcheck preference.')
      }
      return session.commit<JournalPreferences>((current) => ({
        state: { ...current, preferences },
        result: preferences
      }))
    },

    async saveHabitRecipe(input: { anchor: string; enabled: boolean }) {
      const anchor = input.anchor.trim().replace(/[.!?,;:]+$/, '')
      if (!anchor || anchor.length > 160 || typeof input.enabled !== 'boolean') {
        throw new JournalError(
          'INVALID_INPUT',
          'Describe one specific daily action for your anchor.'
        )
      }
      return session.commit<HabitRecipe>((current) => {
        const timestamp = session.clock.now().toISOString()
        const recipe: HabitRecipe = {
          anchor,
          enabled: input.enabled,
          sentence: formatHabitRecipeSentence(anchor),
          createdAt: current.habitRecipe?.createdAt ?? timestamp,
          updatedAt: timestamp
        }
        return {
          state: {
            ...current,
            habitRecipe: recipe,
            habitRecipeInviteDismissed: true
          },
          result: recipe
        }
      })
    },

    async dismissHabitRecipeInvite() {
      return session.commit((current) => ({
        state: { ...current, habitRecipeInviteDismissed: true },
        result: { dismissed: true as const }
      }))
    },

    async setHabitRecipeEnabled(enabled: boolean) {
      if (typeof enabled !== 'boolean') {
        throw new JournalError('INVALID_INPUT', 'Choose whether the Habit Recipe is enabled.')
      }
      return session.commit<HabitRecipe>((current) => {
        if (!current.habitRecipe) {
          throw new JournalError('INVALID_INPUT', 'Create a Habit Recipe before changing it.')
        }
        const recipe = {
          ...current.habitRecipe,
          enabled,
          updatedAt: session.clock.now().toISOString()
        }
        return { state: { ...current, habitRecipe: recipe }, result: recipe }
      })
    }
  }
}
