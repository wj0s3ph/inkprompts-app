import { useState } from 'react'
import { formatHabitRecipeSentence } from '../../../../shared/habit-recipe'
import type { CommonSettingsProps } from './types'

export function HabitRecipeSettings({
  api,
  busy,
  run,
  view,
  refresh,
  showMessage
}: CommonSettingsProps): React.JSX.Element {
  const [anchor, setAnchor] = useState(view.habitRecipe?.anchor ?? '')

  const saveRecipe = (): void => {
    run('recipe', async () => {
      await api.saveHabitRecipe({ anchor, enabled: true })
      showMessage('Habit Recipe saved.')
      await refresh()
    })
  }

  const toggleRecipe = (): void => {
    if (!view.habitRecipe) return
    run('recipe-toggle', async () => {
      await api.setHabitRecipeEnabled(!view.habitRecipe!.enabled)
      await refresh()
    })
  }

  return (
    <section aria-labelledby="recipe-title">
      <h2 id="recipe-title" className="settings-heading">
        Habit Recipe
      </h2>
      <p className="settings-copy">
        Connect one honest sentence to something that already happens in your day. No notification
        is scheduled.
      </p>
      <label className="mt-4 block">
        <span className="field-label">After I…</span>
        <input
          className="text-field"
          list="anchor-suggestions"
          placeholder="close my laptop"
          value={anchor}
          onChange={(event) => setAnchor(event.target.value)}
        />
      </label>
      <datalist id="anchor-suggestions">
        <option value="I finish breakfast" />
        <option value="I close my laptop" />
        <option value="I plug in my phone" />
        <option value="I make evening tea" />
      </datalist>
      {anchor ? <p className="settings-note mt-3">{formatHabitRecipeSentence(anchor)}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="secondary-button"
          disabled={!anchor.trim() || busy === 'recipe'}
          type="button"
          onClick={saveRecipe}
        >
          Save recipe
        </button>
        {view.habitRecipe ? (
          <button className="text-button" type="button" onClick={toggleRecipe}>
            {view.habitRecipe.enabled ? 'Turn off' : 'Turn on'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
