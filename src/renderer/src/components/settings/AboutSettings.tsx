import { Info } from 'lucide-react'

interface AboutSettingsProps {
  version: string
}

export function AboutSettings({ version }: AboutSettingsProps): React.JSX.Element {
  return (
    <section aria-labelledby="about-settings-title">
      <div className="flex items-center gap-3">
        <Info aria-hidden="true" className="text-[var(--accent-text)]" size={20} />
        <h2 id="about-settings-title" className="settings-heading">
          About
        </h2>
      </div>
      <p className="settings-copy font-medium text-[var(--text)]">Version {version}</p>
    </section>
  )
}
