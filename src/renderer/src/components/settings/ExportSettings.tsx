import type { JournalApi } from '../../../../preload/index'
import type { RunSettingAction } from './types'

interface ExportSettingsProps {
  api: JournalApi
  run: RunSettingAction
  requireDurableDraft(): Promise<void>
  showMessage(message: string): void
}

export function ExportSettings({
  api,
  run,
  requireDurableDraft,
  showMessage
}: ExportSettingsProps): React.JSX.Element {
  const exportJournal = (format: 'markdown' | 'txt' | 'json'): void => {
    if (
      !window.confirm('This ordinary export is not encrypted. Save it only somewhere you trust.')
    ) {
      return
    }
    run(`export-${format}`, async () => {
      await requireDurableDraft()
      const result = await api.exportJournal({ format, unencryptedConfirmed: true })
      showMessage(
        result.status === 'saved' ? `${format.toUpperCase()} export saved.` : 'Export cancelled.'
      )
    })
  }

  return (
    <section aria-labelledby="export-title">
      <h2 id="export-title" className="settings-heading">
        Unencrypted export
      </h2>
      <p className="settings-copy">
        Markdown, TXT, and JSON exports are ordinary readable files. They are not encrypted.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {(['markdown', 'txt', 'json'] as const).map((format) => (
          <button
            key={format}
            className="secondary-button"
            type="button"
            onClick={() => exportJournal(format)}
          >
            Export {format === 'markdown' ? 'Markdown' : format.toUpperCase()}
          </button>
        ))}
      </div>
    </section>
  )
}
