import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

/**
 * Convert Markdown into clean, readable plain text for destinations that don't
 * render Markdown (X, mailto email). Strips syntax markers while keeping the
 * text, line structure, and link URLs.
 *
 * Intentionally dependency-free and good enough for typical note content —
 * not a full CommonMark parser.
 */
export function markdownToText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n')

  // Fenced code blocks: keep the inner code, drop the ``` fences.
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) =>
    code.replace(/\n$/, ''),
  )

  // Line-level markers.
  text = text
    .split('\n')
    .map((line) => {
      // Horizontal rule -> blank line.
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return ''
      return line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // heading markers
        .replace(/^\s{0,3}>\s?/, '') // blockquote markers
        .replace(/^(\s*)[*+]\s+/, '$1- ') // normalize bullets to "- "
    })
    .join('\n')

  // Inline constructs.
  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => url || alt) // image -> url
    .replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, label, url) =>
      !label || label === url ? url : `${label} (${url})`,
    ) // link -> "label (url)"
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/`([^`]+)`/g, '$1') // inline code

  // Tidy whitespace.
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The editor (Milkdown) preserves blank lines by serializing each empty
 * paragraph as a paragraph containing only `<br />`. That round-trips nicely
 * in the editor, but other destinations should get plain Markdown — so collapse
 * those standalone breaks back into real blank lines. Only matches a `<br>` that
 * is alone on its line, leaving genuine in-paragraph line breaks intact.
 */
export function stripEmptyLineBreaks(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '') // empty-line marker → blank line
    .replace(/\n{3,}/g, '\n\n') // collapse the runs of blanks that leaves
    .replace(/^\n+|\n+$/g, '') // trim leading/trailing blank lines
}

/** Remove the first top-level `# ` heading (and a blank line after it). Used to
 *  drop the title from the body once it's been lifted into front matter. */
export function stripFirstH1(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const i = lines.findIndex((l) => /^#\s+\S/.test(l))
  if (i === -1) return markdown
  lines.splice(i, 1)
  if (lines[i] === '') lines.splice(i, 1) // collapse the gap the heading left
  return lines.join('\n').replace(/^\n+/, '')
}

/** Drop inline image syntax `![alt](url)`, leaving surrounding text intact. */
export function stripImages(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Inline styles keyed by tag name. Rich-text editors that accept pasted HTML —
 * notably WeChat's Official Accounts editor — strip `<style>` blocks and class
 * selectors, keeping only inline `style="…"` attributes. So everything that
 * should survive the paste has to be inlined here. Kept deliberately neutral so
 * the result reads well inside the target's own article frame.
 */
const HTML_STYLES: Record<string, string> = {
  h1: 'font-size:22px;font-weight:700;line-height:1.4;margin:24px 0 16px',
  h2: 'font-size:20px;font-weight:700;line-height:1.4;margin:24px 0 16px',
  h3: 'font-size:18px;font-weight:700;line-height:1.4;margin:20px 0 12px',
  h4: 'font-size:16px;font-weight:700;line-height:1.4;margin:20px 0 12px',
  p: 'font-size:16px;line-height:1.75;margin:16px 0;color:#333',
  blockquote:
    'border-left:4px solid #ddd;padding:8px 12px;margin:16px 0;color:#666;background:#f7f7f7',
  ul: 'margin:16px 0;padding-left:24px',
  ol: 'margin:16px 0;padding-left:24px',
  li: 'font-size:16px;line-height:1.75;margin:4px 0',
  img: 'max-width:100%;height:auto',
  table: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:14px',
  th: 'border:1px solid #ddd;padding:6px 12px;background:#f7f7f7;text-align:left',
  td: 'border:1px solid #ddd;padding:6px 12px',
  hr: 'border:none;border-top:1px solid #ddd;margin:24px 0',
}
const PRE_STYLE =
  'background:#f6f8fa;border-radius:6px;padding:16px;margin:16px 0;overflow-x:auto;' +
  'font-size:14px;line-height:1.5'
const PRE_CODE_STYLE = 'font-family:Menlo,Consolas,monospace;background:none;padding:0'
const INLINE_CODE_STYLE =
  'font-family:Menlo,Consolas,monospace;background:#f6f8fa;border-radius:3px;padding:2px 4px;font-size:90%'
const LINK_TEXT_STYLE = 'color:#576b95'
const SUP_STYLE = 'color:#576b95;font-size:75%'
const REF_TITLE_STYLE = 'font-size:15px;font-weight:700;margin:24px 0 8px;color:#333'
const REF_ITEM_STYLE = 'font-size:13px;line-height:1.7;margin:4px 0;color:#888;word-break:break-all'

/**
 * WeChat strips most outbound links — a pasted `<a href>` to anything but a
 * WeChat article becomes dead text, so the URL is lost. Mirror what dedicated
 * "Markdown → WeChat" tools do: replace each such link with a superscript
 * marker and collect the URLs, to be listed at the foot of the article. Links
 * to WeChat's own articles stay clickable. Operates on micromark's `<a>` output
 * before inline styling.
 */
function footnoteLinks(html: string): { html: string; refs: string[] } {
  const refs: string[] = []
  const out = html.replace(
    /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    (_m, href: string, text: string) => {
      // WeChat keeps links to its own articles working — leave them clickable.
      if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) {
        return `<a href="${href}" style="${LINK_TEXT_STYLE}">${text}</a>`
      }
      // A bare URL already shows its address as text — no footnote needed.
      if (text === href) return `<span style="${LINK_TEXT_STYLE}">${text}</span>`
      refs.push(href)
      return `<span style="${LINK_TEXT_STYLE}">${text}</span><sup style="${SUP_STYLE}">[${refs.length}]</sup>`
    },
  )
  return { html: out, refs }
}

/**
 * Render Markdown to "MP HTML": HTML tailored for WeChat's Official Accounts
 * (公众号 / mp.weixin.qq.com) editor rather than the generic web. Every tag
 * carries inline styles (the editor drops <style> and classes), outbound links
 * become numbered footnotes (see footnoteLinks, since WeChat won't keep them
 * live), and images keep their original `<img src>` URLs — the editor fetches
 * and re-hosts them on paste, so uploading to an image host first is what makes
 * them "land" in the published post. Drop the result on the clipboard as
 * `text/html` and paste it into a new article.
 */
export function markdownToMpHtml(markdown: string): string {
  const rendered = micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })
  const { html, refs } = footnoteLinks(rendered)
  let out = html
    // Code blocks first: <pre><code class="language-x"> → styled pair, so the
    // bare-<code> pass below only catches inline code.
    .replace(/<pre><code[^>]*>/g, `<pre style="${PRE_STYLE}"><code style="${PRE_CODE_STYLE}">`)
    .replace(/<code>/g, `<code style="${INLINE_CODE_STYLE}">`)
  for (const [tag, style] of Object.entries(HTML_STYLES)) {
    // Match the opening tag whether or not it has attributes, preserving them.
    out = out.replace(
      new RegExp(`<${tag}(\\s|>|/)`, 'g'),
      (_m, after: string) => `<${tag} style="${style}"${after === '>' ? '>' : ' '}`,
    )
  }
  if (refs.length) {
    const items = refs
      .map((url, i) => `<p style="${REF_ITEM_STYLE}">[${i + 1}] ${url}</p>`)
      .join('')
    out += `<hr style="${HTML_STYLES.hr}"/><p style="${REF_TITLE_STYLE}">引用链接</p>${items}`
  }
  return out
}
