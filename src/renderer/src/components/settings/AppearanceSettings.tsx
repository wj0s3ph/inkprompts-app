import type { CommonSettingsProps } from './types'

export function AppearanceSettings({
  api,
  busy,
  run,
  view,
  refresh
}: CommonSettingsProps): React.JSX.Element {
  const updateTheme = (theme: 'system' | 'light' | 'dark'): void => {
    run('theme', async () => {
      await api.updatePreferences({ ...view.preferences, theme })
      await refresh()
    })
  }

  const updateSpellcheck = (spellcheck: boolean): void => {
    run('spellcheck', async () => {
      await api.updatePreferences({ ...view.preferences, spellcheck })
      await refresh()
    })
  }

  return (
    <section aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="settings-heading">
        Appearance & writing
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="field-label">Theme</span>
          <select
            className="text-field"
            disabled={busy === 'theme'}
            value={view.preferences.theme}
            onChange={(event) => updateTheme(event.target.value as 'system' | 'light' | 'dark')}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="setting-option spellcheck-option">
          <input
            checked={view.preferences.spellcheck}
            type="checkbox"
            onChange={(event) => updateSpellcheck(event.target.checked)}
          />
          <span>Use native spellcheck</span>
        </label>
      </div>
    </section>
  )
}
