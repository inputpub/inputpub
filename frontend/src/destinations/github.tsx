import type { Destination } from './types'
import { deriveTitle } from '../lib/title'
import { renderTemplate, templateVars } from '../lib/template'
import { GitHubIcon } from './icons'

/** Encode a UTF-8 string to base64 (btoa alone breaks on non-Latin1, e.g. CJK). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * Commit the markdown as a `.md` file into a GitHub repository via the Contents
 * API, using the user's own Personal Access Token (repo scope). Repo + dir come
 * from settings; the filename is entered at publish time. Re-publishing the same
 * path updates the existing file.
 */
export const github: Destination = {
  id: 'github',
  name: 'GitHub',
  icon: GitHubIcon,
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'ghp_…',
      hint: (
        <>
          Use a classic token with the <b>repo</b> scope.{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=Input%20Pub%20(repo)"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Create one ↗
          </a>
        </>
      ),
    },
    { key: 'repo', label: 'Repository (owner/repo)', placeholder: 'timqian/notes' },
    { key: 'dir', label: 'Folder (optional)', placeholder: 'posts', optional: true },
    {
      key: 'template',
      label: 'Output template (optional)',
      type: 'textarea',
      optional: true,
      placeholder: '---\ntitle: {{ title | quote }}\ndate: {{ date }}\n---\n\n{{ body | no-title }}',
      hint: (
        <>
          Leave empty to commit the raw Markdown. Variables: <code>{'{{title}}'}</code>{' '}
          <code>{'{{date}}'}</code> <code>{'{{datetime}}'}</code> <code>{'{{body}}'}</code> (raw){' '}
          <code>{'{{filename}}'}</code>. Filters: <code>| plain</code> <code>| no-title</code>{' '}
          <code>| no-images</code> <code>| quote</code>.
        </>
      ),
    },
  ],
  prompt: [{ key: 'filename', label: 'File name', placeholder: 'my-post.md' }],
  async send(markdown, ctx) {
    const token = ctx.getConfig('token')
    const repo = (ctx.getConfig('repo') ?? '').trim()
    if (!token) throw new Error('Missing GitHub token')
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Repository must be in owner/repo format')

    const dir = (ctx.getConfig('dir') ?? '').replace(/^\/+|\/+$/g, '')
    let filename = (ctx.input.filename ?? '').trim()
    if (!filename) throw new Error('Please enter a file name')
    if (!/\.[a-z0-9]+$/i.test(filename)) filename += '.md'
    const path = dir ? `${dir}/${filename}` : filename

    // Optional output template (e.g. add front matter). Empty → raw Markdown.
    const template = (ctx.getConfig('template') ?? '').trim()
    const content = template ? renderTemplate(template, templateVars(markdown, { filename })) : markdown

    const base = `https://api.github.com/repos/${repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }

    // If the file already exists, we need its sha to update (overwrite) it.
    let sha: string | undefined
    const existing = await fetch(base, { headers })
    if (existing.ok) {
      const data = (await existing.json()) as { sha?: string }
      sha = data.sha
    } else if (existing.status !== 404) {
      const detail = await existing.text().catch(() => '')
      throw new Error(`Couldn't read the repo (${existing.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`)
    }

    const res = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} ${path} — ${deriveTitle(markdown) || 'Input Pub'}`,
        content: toBase64(content),
        ...(sha ? { sha } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Commit failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }

    const data = (await res.json()) as { content?: { html_url?: string } }
    if (data.content?.html_url) window.open(data.content.html_url, '_blank', 'noopener,noreferrer')
    return sha ? 'File updated' : 'Committed to repo'
  },
}
