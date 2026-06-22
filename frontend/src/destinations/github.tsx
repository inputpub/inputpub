import type { Destination } from './types'
import { deriveTitle } from '../lib/title'

const GitHubMark = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

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
  icon: GitHubMark,
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'github_pat_…',
      hint: (
        <>
          建 fine-grained token，对目标仓库授予 <b>Contents: Read and write</b> 权限。{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
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
