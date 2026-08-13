import { ExternalLink, Info } from 'lucide-react'
import type { JournalApi } from '../../../../preload/index'
import type { AppInfo, ExternalPageId } from '../../../../shared/product-info'

interface AboutSettingsProps {
  appInfo: AppInfo
  openExternalPage: JournalApi['openExternalPage']
}

const pages: Array<{ id: ExternalPageId; label: string }> = [
  { id: 'website', label: 'Website' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
  { id: 'support', label: 'Support' }
]

export function AboutSettings({
  appInfo,
  openExternalPage
}: AboutSettingsProps): React.JSX.Element {
  return (
    <section aria-labelledby="about-settings-title">
      <div className="flex items-center gap-3">
        <Info aria-hidden="true" className="text-[var(--accent-text)]" size={20} />
        <h2 id="about-settings-title" className="settings-heading">
          About
        </h2>
      </div>
      <p className="settings-copy font-medium text-[var(--text)]">
        {appInfo.name} {appInfo.version}
      </p>
      <p className="settings-copy">{appInfo.copyright}</p>
      <p className="settings-note mt-4">{appInfo.privacySummary}</p>
      <p className="settings-copy">Open source under {appInfo.license}</p>
      <p className="settings-copy break-all">{appInfo.sourceCodeUrl}</p>
      <nav aria-label="InkPrompts information" className="mt-4 flex flex-wrap gap-2">
        {pages.map((page) => (
          <button
            className="text-button"
            key={page.id}
            type="button"
            onClick={() => void openExternalPage(page.id)}
          >
            {page.label} <ExternalLink aria-hidden="true" size={15} />
          </button>
        ))}
      </nav>
    </section>
  )
}
