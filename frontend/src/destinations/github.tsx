import type { Destination } from './types'
import { deriveTitle } from '../lib/title'
import { GitHubIcon } from './icons'

/** Encode a UTF-8 string to base64 (btoa alone breaks on non-Latin1, e.g. 中文). */
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
          用一个 classic token，勾选 <b>repo</b>。{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=Input%20Pub%20(repo)"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            去创建 ↗
          </a>
        </>
      ),
    },
    { key: 'repo', label: '仓库 (owner/repo)', placeholder: 'timqian/notes' },
    { key: 'dir', label: '目录（可选）', placeholder: 'posts', optional: true },
  ],
  prompt: [{ key: 'filename', label: '文件名', placeholder: 'my-post.md' }],
  async send(markdown, ctx) {
    const token = ctx.getConfig('token')
    const repo = (ctx.getConfig('repo') ?? '').trim()
    if (!token) throw new Error('缺少 GitHub Token')
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('仓库格式应为 owner/repo')

    const dir = (ctx.getConfig('dir') ?? '').replace(/^\/+|\/+$/g, '')
    let filename = (ctx.input.filename ?? '').trim()
    if (!filename) throw new Error('请填写文件名')
    if (!/\.[a-z0-9]+$/i.test(filename)) filename += '.md'
    const path = dir ? `${dir}/${filename}` : filename

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
      throw new Error(`读取仓库失败 (${existing.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`)
    }

    const res = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} ${path} — ${deriveTitle(markdown) || 'Input Pub'}`,
        content: toBase64(markdown),
        ...(sha ? { sha } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`提交失败 (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }

    const data = (await res.json()) as { content?: { html_url?: string } }
    if (data.content?.html_url) window.open(data.content.html_url, '_blank', 'noopener,noreferrer')
    return sha ? '已更新文件' : '已提交到仓库'
  },
}
