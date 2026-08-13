import {
  richTextToPlainText,
  type DailyEntry,
  type RichTextMark,
  type RichTextNode
} from '../../shared/journal-contract'

export type JournalExportFormat = 'markdown' | 'txt' | 'json'

export function renderJournalExport(
  entries: DailyEntry[],
  format: JournalExportFormat,
  exportedAt: string
): string {
  const ordered = [...entries].sort((left, right) => left.date.localeCompare(right.date))
  if (format === 'json') {
    return JSON.stringify(
      {
        format: 'inkprompts-journal-export',
        version: 1,
        exportedAt,
        entries: ordered
      },
      null,
      2
    )
  }
  if (format === 'txt') {
    return ordered
      .map((entry) =>
        [entry.date, entry.title || null, richTextToPlainText(entry.content)]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n---\n\n')
  }
  return ordered
    .map((entry) => {
      const title = entry.title ? `\n\n## ${escapeMarkdown(entry.title)}` : ''
      return `# ${entry.date}${title}\n\n${nodesToMarkdown(entry.content.content)}`
    })
    .join('\n\n---\n\n')
}

function nodesToMarkdown(nodes: RichTextNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return markedText(node.text ?? '', node.marks ?? [])
      if (node.type === 'paragraph' || node.type === 'listItem') {
        return nodesToMarkdown(node.content ?? [])
      }
      if (node.type === 'bulletList') {
        return (node.content ?? [])
          .map((item) => `- ${nodesToMarkdown(item.content ?? [])}`)
          .join('\n')
      }
      if (node.type === 'orderedList') {
        return (node.content ?? [])
          .map((item, index) => `${index + 1}. ${nodesToMarkdown(item.content ?? [])}`)
          .join('\n')
      }
      if (node.type === 'blockquote') {
        return nodesToMarkdown(node.content ?? [])
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
      }
      return ''
    })
    .filter(Boolean)
    .join(nodes.some((node) => node.type === 'text') ? '' : '\n\n')
}

function markedText(value: string, marks: RichTextMark[]): string {
  let output = escapeMarkdown(value)
  for (const mark of marks) {
    if (mark.type === 'bold') output = `**${output}**`
    if (mark.type === 'italic') output = `_${output}_`
    if (mark.type === 'link' && mark.attrs) output = `[${output}](${mark.attrs.href})`
  }
  return output
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}
