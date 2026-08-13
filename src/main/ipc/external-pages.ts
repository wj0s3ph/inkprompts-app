import { JournalError } from '../journal-error'
import type { ExternalPageId } from '../../shared/product-info'
import externalPageUrls from './external-page-urls.json'

export const EXTERNAL_PAGE_URLS: Readonly<Record<ExternalPageId, string>> = externalPageUrls

export function assertExternalPageId(value: unknown): asserts value is ExternalPageId {
  if (typeof value !== 'string' || !Object.hasOwn(EXTERNAL_PAGE_URLS, value)) {
    throw new JournalError('INVALID_INPUT', 'Choose one of the available InkPrompts pages.')
  }
}

export function assertExternalPageIpcArguments(
  args: readonly unknown[]
): asserts args is readonly [ExternalPageId] {
  if (args.length !== 1) {
    throw new JournalError('INVALID_INPUT', 'The renderer request had an invalid shape.')
  }
  assertExternalPageId(args[0])
}
