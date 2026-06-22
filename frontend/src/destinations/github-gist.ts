import type { Destination } from './types'
import { deriveTitle } from '../lib/title'

/**
 * Create a private GitHub Gist using the user's own Personal Access Token,
 * stored locally. GitHub's API supports CORS, so this works without a backend.
 */
export const githubGist: Destination = {
  id: 'github-gist',
  name: 'GitHub Gist',
  icon: '🐙',
  config: [
    {
      key: 'token',
      label: 'GitHub Personal Access Token',
      placeholder: 'ghp_… (需 gist 权限)',
      type: 'password',
    },
  ],
  async send(markdown, ctx) {
    const token = ctx.getConfig('token')
    if (!token) throw new Error('缺少 GitHub Token')

    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: deriveTitle(markdown) || 'input pub',
        public: false,
        files: { 'input.md': { content: markdown } },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`创建 Gist 失败 (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`)
    }

    const data = (await res.json()) as { html_url?: string }
    if (data.html_url) window.open(data.html_url, '_blank', 'noopener,noreferrer')
    return 'Gist 创建成功'
  },
}
