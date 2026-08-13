# InkPrompts Journal

> One honest sentence is enough.

InkPrompts Journal is a calm, private desktop journal for people who want to return to writing without streaks, scores, or pressure. It is the offline writing companion to [InkPrompts.com](https://inkprompts.com/): use the website for beginner-friendly guidance, 230 thoughtful prompts, and printable exercises, then use the app to keep one encrypted Daily Entry for each day.

Every entry stays in a Journal Vault on your device. There is no account, cloud sync, telemetry, AI, automatic update check, or notification service.

## The website and the app

[InkPrompts.com](https://inkprompts.com/) helps you find a small, specific place to begin. Its prompt library covers daily reflection, gratitude, mental health, self-discovery, creativity, relationships, personal growth, kids, teens, and careful shadow work. A prompt is an invitation rather than an assignment: one line, a list, or an unfinished thought can be enough.

InkPrompts Journal gives that writing a durable home. The website is not embedded in the desktop app, and the prompt library is not silently downloaded. The app remains offline while you write.

## What works today

- One Daily Entry per local calendar date, with today and past dates editable and future dates read-only
- A focused rich-text editor with an optional title, automatic durable saves, native spellcheck, and light, dark, or system themes
- Calendar navigation and full-journal local search
- A gentle Writing Starter for an empty day, **Done for Today**, and an optional Habit Recipe that connects one honest sentence to an existing routine without reminders or streaks
- An optional six-digit PIN Lock for everyday privacy
- Automatic encrypted Device Snapshots, with an extra snapshot before destructive recovery actions
- Password-protected Portable Backups that can be restored on another supported device
- Explicit, unencrypted exports in Markdown, TXT, and JSON

## Privacy and recovery model

The Journal Vault is encrypted at rest with AES-256-GCM using a random vault key protected by the operating system. Encryption keys, vault paths, journal contents, search, backup, and export stay in the Electron main process. The sandboxed renderer has no Node.js or direct filesystem access, and its production policy blocks network connections.

PIN Lock prevents casual access to the open app; it is not the vault encryption password and cannot be recovered. Forgetting the PIN requires clearing the local Journal Vault and restoring a Portable Backup, if one exists.

PIN Lock protects confidentiality inside the app, not data availability. From the locked screen, the forgotten-PIN flow can erase the local Journal Vault only after the user types the full destructive confirmation phrase; it cannot verify a PIN the user no longer knows. A person or process with operating-system-level access could also delete local app data directly, so keep a current Portable Backup if losing the device copy would matter.

Device Snapshots are encrypted with the current device's system-protected key and cannot be moved to another device. Portable Backups use a separate password and are designed for recovery or migration. Markdown, TXT, and JSON exports are intentionally readable and unencrypted, so store them only somewhere you trust.

On Linux, InkPrompts Journal refuses to create a vault when Electron can provide only the insecure `basic_text` storage backend.

## Current status

The repository is at the `1.0.0` release-candidate stage. The writing, search, privacy lock, recovery, backup, export, and packaging flows are implemented and covered by automated behavior and production Electron tests. Certificate-free development packaging is configured for macOS, Windows, and Linux.

This public repository intentionally contains no credential-backed signing or store-release workflow. Distribution signing, notarization, Mac App Store packaging, credentials, and release automation are maintained in a separate private environment.

## Develop and verify

Requirements: Node.js 22 or newer and npm 11.

```bash
npm ci
npm run dev
```

Run the complete repeatable check before committing:

```bash
npm run verify
```

This checks formatting and lint rules, runs the application behavior suite, type-checks and builds the production bundles, verifies third-party notices against the packages that actually contributed code to those bundles, then launches the production Electron renderer for its offline and process-isolation smoke test.

## Package locally

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

Artifacts are written to `dist/`. Local packages are not distribution-signed and are suitable for development testing, not trusted public distribution. Apple Silicon development packages use only a certificate-free ad-hoc signature so macOS can execute them; it provides no developer identity, notarization, or user trust. The app has no automatic updater; upgrades are installed manually and retain the Journal Vault.

## Project links

- Journaling guides, prompts, and printables: [inkprompts.com](https://inkprompts.com/)
- Product website: [inkprompts.com/journal](https://inkprompts.com/journal)
- Support: [inkprompts.com/contact](https://inkprompts.com/contact)
- Source code: [github.com/wj0s3ph/inkprompts-app](https://github.com/wj0s3ph/inkprompts-app)

InkPrompts Journal supports private reflection; it is not therapy or a substitute for professional mental health care.

## License

The source code in this repository is available under the [Mozilla Public License 2.0](LICENSE). Changes to MPL-covered files must remain available under MPL-2.0 when they are distributed; larger works may use different terms as allowed by the license.

The InkPrompts and InkPrompts Journal names, application icons, and visual assets listed in [ASSETS-LICENSE.md](ASSETS-LICENSE.md) are excluded from the MPL-2.0 grant. Third-party components remain under their respective licenses; their inventory and license texts are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [OPEN_SOURCE_NOTICES.md](OPEN_SOURCE_NOTICES.md) for source availability information.
