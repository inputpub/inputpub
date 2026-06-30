import { deriveTitle } from './title'
import { markdownToText, markdownToMpHtml, stripFirstH1, stripImages } from './markdown'

/**
 * A tiny, safe template engine for shaping a note before it's published.
 *
 *   {{ source | filter | filter }}
 *
 * No code execution — just variable lookup + a fixed set of string filters,
 * applied left to right. Unknown sources render empty; unknown filters are
 * ignored. Per-destination templates let each person decide how their Markdown
 * maps to a given target (e.g. front matter for a GitHub repo).
 */

/** String filters that can be piped onto a value. */
const FILTERS: Record<string, (s: string) => string> = {
  plain: (s) => markdownToText(s), // strip Markdown styling → readable text
  'mp-html': (s) => markdownToMpHtml(s), // Markdown → WeChat (公众号) HTML for rich paste
  'no-title': (s) => stripFirstH1(s), // drop the first # heading
  'no-images': (s) => stripImages(s), // drop ![](…) image syntax
  quote: (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, // YAML-safe
}

/** Variable names a template may reference, for docs/placeholder text. */
export const TEMPLATE_VARS = ['title', 'date', 'datetime', 'body', 'filename'] as const
export const TEMPLATE_FILTERS = Object.keys(FILTERS)

/** Build the standard variables from the note's Markdown (+ any extras like the
 *  publish-time filename). `body` is the raw, untouched Markdown. */
export function templateVars(
  markdown: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    title: deriveTitle(markdown),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    datetime: d.toISOString(),
    body: markdown,
    ...extra,
  }
}

/** Render a `{{ var | filter }}` template against the given variables. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const [source, ...filters] = expr.split('|').map((t) => t.trim())
    let value = vars[source] ?? ''
    for (const name of filters) {
      const fn = FILTERS[name]
      if (fn) value = fn(value)
    }
    return value
  })
}
