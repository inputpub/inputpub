import type { ImageHost } from './types'
import { GitHubIcon } from '../destinations/icons'
import { githubRepoTokenHint } from '../components/githubTokenHint'
import { req, uniqueName } from './shared'

/** Encode bytes to base64 in chunks (btoa needs a binary string; spreading the
 *  whole array overflows the stack for large files). */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Commit images into a public GitHub repo via the Contents API and embed the
 *  returned raw URL. Uses the user's own token (repo scope). */
export const githubHost: ImageHost = {
  id: 'github',
  name: 'GitHub repo',
  icon: GitHubIcon,
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'github_pat_…',
      hint: (
        <>
          Images are committed to a <b>public</b> repo and embedded via their raw URL.{' '}
          {githubRepoTokenHint}
        </>
      ),
    },
    { key: 'repo', label: 'Repository (owner/repo)', placeholder: 'timqian/images' },
    { key: 'folder', label: 'Folder (optional)', placeholder: 'images', optional: true },
  ],
  async upload(file, ctx) {
    const token = req(ctx, 'token', 'GitHub token')
    const repo = req(ctx, 'repo', 'repository')
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Repository must be in owner/repo format')

    const folder = (ctx.getConfig('folder') ?? '').replace(/^\/+|\/+$/g, '')
    const name = uniqueName(file.name)
    const path = folder ? `${folder}/${name}` : name

    const url = `https://api.github.com/repos/${repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: `Add ${path} — Input Pub`, content: toBase64(bytes) }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Upload failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }

    const data = (await res.json()) as { content?: { download_url?: string } }
    if (!data.content?.download_url) throw new Error('Upload succeeded but no URL was returned')
    return data.content.download_url
  },
}
