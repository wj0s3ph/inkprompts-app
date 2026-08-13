interface VaultErasureScopeNoticeProps {
  className: string
}

export function VaultErasureScopeNotice({
  className
}: VaultErasureScopeNoticeProps): React.JSX.Element {
  return (
    <div className={`recovery-warning ${className}`}>
      <p>
        This cryptographically erases the App-managed Vault key, entries, PIN Lock, Habit Recipe,
        preferences, and all Device Snapshots from this Mac.
      </p>
      <p>
        Portable Backups, Markdown/TXT/JSON exports, Time Machine and APFS system snapshots, and
        other copies you manage are not deleted.
      </p>
      <p>This is not forensic disk overwriting.</p>
    </div>
  )
}
