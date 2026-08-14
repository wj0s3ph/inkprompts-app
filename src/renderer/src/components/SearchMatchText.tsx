import type { TextMatchRange } from '../../../shared/journal-contract'

interface SearchMatchTextProps {
  text: string
  ranges: TextMatchRange[]
}

export function SearchMatchText({ text, ranges }: SearchMatchTextProps): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const range of ranges) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < cursor ||
      range.end <= range.start ||
      range.end > text.length
    ) {
      continue
    }
    if (range.start > cursor) parts.push(text.slice(cursor, range.start))
    parts.push(
      <mark className="search-match" key={`${range.start}:${range.end}`}>
        {text.slice(range.start, range.end)}
      </mark>
    )
    cursor = range.end
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
