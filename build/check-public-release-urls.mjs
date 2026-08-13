import { readFile } from 'node:fs/promises'

const releaseUrlsById = JSON.parse(
  await readFile(new URL('../src/main/ipc/external-page-urls.json', import.meta.url), 'utf8')
)
const releaseUrls = Object.values(releaseUrlsById)

for (const releaseUrl of releaseUrls) {
  let current = new URL(releaseUrl)
  let response

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    response = await fetch(current, { redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) break

    const location = response.headers.get('location')
    if (!location) throw new Error(`${current} returned a redirect without a location.`)
    current = new URL(location, current)
    if (current.origin !== 'https://inkprompts.com') {
      throw new Error(`${releaseUrl} redirects outside https://inkprompts.com.`)
    }
  }

  if (!response || response.status !== 200) {
    const status = response ? `HTTP ${response.status}` : 'no HTTP response'
    throw new Error(`${releaseUrl} finished with ${status}; expected HTTP 200.`)
  }
  if (current.pathname !== new URL(releaseUrl).pathname || current.search) {
    throw new Error(`${releaseUrl} unexpectedly finishes at ${current.href}.`)
  }
  process.stdout.write(`Verified ${releaseUrl}\n`)
}
