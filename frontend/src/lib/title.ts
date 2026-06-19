/**
 * Derive a short title from markdown: the first ATX heading text, or failing
 * that the first non-empty line, stripped of common markdown markers.
 */
export function deriveTitle(markdown: string): string {
  const lines = markdown.split('\n')

  const heading = lines.find((l) => /^#{1,6}\s+/.test(l.trim()))
  if (heading) return heading.replace(/^#{1,6}\s+/, '').trim()

  const firstLine = lines.find((l) => l.trim().length > 0)
  if (!firstLine) return ''

  return firstLine
    .trim()
    .replace(/^[#>\-*+\s]+/, '') // leading markdown markers
    .replace(/[*_`~]/g, '') // inline emphasis markers
    .trim()
    .slice(0, 80)
}
