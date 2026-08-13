import { useRef, useState } from 'react'
import { ArchiveRestore, ExternalLink, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { JournalApi } from '../../../preload/index'
import heroWriting from '../assets/hero-writing.svg'

interface WelcomeProps {
  busy: boolean
  onStart(): void
  onRestore: JournalApi['restorePortableBackup']
  openExternalPage: JournalApi['openExternalPage']
}

export function Welcome({
  busy,
  onStart,
  onRestore,
  openExternalPage
}: WelcomeProps): React.JSX.Element {
  const passwordRef = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const restore = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setRestoring(true)
    setError('')
    setMessage('')
    try {
      const result = await onRestore({ password })
      if (result.status === 'cancelled') {
        setMessage('No backup was selected. No Journal Vault was created.')
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setRestoring(false)
    }
    window.setTimeout(() => passwordRef.current?.focus(), 0)
  }

  const openPage = async (page: Parameters<JournalApi['openExternalPage']>[0]): Promise<void> => {
    setError('')
    try {
      await openExternalPage(page)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return (
    <main className="welcome-shell">
      <section aria-labelledby="welcome-title" className="welcome-layout">
        <div className="welcome-copy">
          <p className="brand-wordmark welcome-wordmark" aria-label="InkPrompts">
            Ink<span>Prompts</span>
          </p>

          <div className="welcome-message">
            <p className="eyebrow">Private journaling for real life</p>
            <h1 id="welcome-title" className="font-editorial welcome-title">
              InkPrompts Journal
            </h1>
            <p className="welcome-lede">
              Write one honest sentence. Your journal stays encrypted on this device, without an
              account or cloud sync.
            </p>
            <div className="welcome-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || restoring}
                onClick={onStart}
              >
                {busy ? 'Opening…' : 'Start writing'}
              </button>
              <button
                aria-expanded={restoreOpen}
                className="secondary-button"
                disabled={busy || restoring}
                type="button"
                onClick={() => {
                  setRestoreOpen(true)
                  setError('')
                  setMessage('')
                }}
              >
                <ArchiveRestore aria-hidden="true" size={17} /> Restore a Portable Backup
              </button>
            </div>

            {restoreOpen ? (
              <form className="welcome-restore" onSubmit={(event) => void restore(event)}>
                <p className="settings-copy">
                  Choose an existing .inkbackup file. Nothing is created unless restoration
                  succeeds.
                </p>
                <label className="mt-4 block" htmlFor="welcome-backup-password">
                  <span className="field-label">Backup password</span>
                  <input
                    autoFocus
                    autoComplete="off"
                    className="text-field"
                    disabled={restoring}
                    id="welcome-backup-password"
                    ref={passwordRef}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {error ? (
                  <p className="error-banner mt-3" role="alert">
                    {error}
                  </p>
                ) : null}
                {message ? (
                  <p className="status-banner mt-3" role="status">
                    {message}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="primary-button"
                    disabled={restoring || password.length === 0}
                    type="submit"
                  >
                    {restoring ? 'Restoring…' : 'Choose Backup and Restore'}
                  </button>
                  <button
                    className="text-button"
                    disabled={restoring}
                    type="button"
                    onClick={() => {
                      setRestoreOpen(false)
                      setPassword('')
                      setError('')
                      setMessage('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {!restoreOpen && error ? (
              <p className="error-banner mt-4" role="alert">
                {error}
              </p>
            ) : null}

            <nav aria-label="InkPrompts information" className="welcome-links">
              <button
                className="text-button"
                type="button"
                onClick={() => void openPage('website')}
              >
                Website <ExternalLink aria-hidden="true" size={15} />
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void openPage('privacy')}
              >
                Privacy <ExternalLink aria-hidden="true" size={15} />
              </button>
            </nav>
          </div>

          <ul className="welcome-trust" aria-label="Privacy features">
            <li>
              <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>A system-protected key encrypts every Daily Entry at rest.</span>
            </li>
            <li>
              <LockKeyhole aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>PIN Lock is optional and can be enabled later for everyday privacy.</span>
            </li>
          </ul>
        </div>

        <figure className="welcome-visual">
          <img
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            height={1402}
            src={heroWriting}
            width={1122}
          />
        </figure>
      </section>
    </main>
  )
}
