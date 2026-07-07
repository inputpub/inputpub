import type { VaultContext, VaultEntry, VaultProvider } from './types'
import { TEXT_EXT, VaultConflictError } from './types'
import { GitHubIcon } from '../destinations/icons'
import { githubRepoTokenHint } from '../components/githubTokenHint'

/** Encode a UTF-8 string to base64 (btoa alone breaks on non-Latin1, e.g. CJK). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
}

function repoAndToken(ctx: VaultContext): { repo: string; token: string } {
  const token = (ctx.getConfig('token') ?? '').trim()
  const repo = (ctx.getConfig('repo') ?? '').trim()
  if (!token) throw new Error('Missing GitHub token')
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Repository must be in owner/repo format')
  return { repo, token }
}

/** Resolves which branch to work against — the configured one, or the repo's
 *  default — and confirms the repo exists and is reachable with this token. */
async function resolveBranch(ctx: VaultContext, repo: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(token) })
  if (res.status === 404) {
    throw new Error(
      `Repository "${repo}" wasn't found. Create it on GitHub first, then check the name and that your token can access it.`,
    )
  }
  if (!res.ok) throw new Error(`Couldn't read the repo (${res.status})`)
  const data = (await res.json()) as { default_branch?: string }
  const branch = (ctx.getConfig('branch') ?? '').trim()
  return branch || data.default_branch || 'main'
}

function contentsUrl(repo: string, path: string, ref?: string): string {
  const base = `https://api.github.com/repos/${repo}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base
}

/**
 * Browse and edit files in an existing GitHub repository via the Contents/
 * Trees API, using the user's own Personal Access Token — the same mechanism
 * as the GitHub publish destination, just kept as its own token so a vault
 * repo can differ from the publish target.
 */
export const githubVault: VaultProvider = {
  id: 'github',
  name: 'GitHub',
  icon: GitHubIcon,
  blurb: 'Store your files in a GitHub repository — works on any device, needs a free GitHub account.',
  connectNote:
    'Your token is saved only in this browser (localStorage) and sent straight to GitHub — never to our servers.',
  batchWrites: { defaultDelaySeconds: 60, delayConfigKey: 'autosaveSeconds' },
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'github_pat_…',
      hint: githubRepoTokenHint,
    },
    {
      key: 'repo',
      label: 'Repository (owner/repo)',
      placeholder: 'timqian/notes',
    },
    { key: 'branch', label: 'Branch (optional)', placeholder: 'main', optional: true },
    {
      key: 'autosaveSeconds',
      label: 'Auto-save after inactivity (seconds)',
      placeholder: '60',
      optional: true,
      hint: 'Saves are commits, so edits are batched into one commit per pause instead of one per keystroke.',
    },
  ],

  label(ctx) {
    return ctx.getConfig('repo')?.trim() || undefined
  },

  async listTree(ctx) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: headers(token) },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Couldn't load the repo tree (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
      )
    }
    const data = (await res.json()) as { tree?: { path: string; type: string }[] }
    const entries: VaultEntry[] = []
    for (const item of data.tree ?? []) {
      if (item.type === 'tree') entries.push({ path: item.path, type: 'dir' })
      else if (item.type === 'blob' && TEXT_EXT.test(item.path))
        entries.push({ path: item.path, type: 'file' })
    }
    return entries
  },

  async readFile(ctx, path) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await fetch(contentsUrl(repo, path, branch), { headers: headers(token) })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Couldn't load the file (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
    const data = (await res.json()) as { content?: string; sha?: string }
    if (!data.sha) throw new Error('Unexpected response reading file')
    return { content: data.content ? fromBase64(data.content) : '', sha: data.sha }
  },

  async writeFile(ctx, path, content, sha) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await fetch(contentsUrl(repo, path), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} ${path}`,
        content: toBase64(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const message = `Save failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`
      if (res.status === 409 || res.status === 422) throw new VaultConflictError(message)
      throw new Error(message)
    }
    const data = (await res.json()) as { content?: { sha?: string } }
    if (!data.content?.sha) throw new Error('Unexpected response saving file')
    return { sha: data.content.sha }
  },

  async deleteFile(ctx, path) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    // The Contents API needs the file's *current* blob sha to delete it.
    // Look it up here rather than making callers cache one — a cached sha
    // goes stale the moment the file is edited, and GitHub then 409s.
    const lookup = await fetch(contentsUrl(repo, path, branch), { headers: headers(token) })
    if (!lookup.ok) {
      const detail = await lookup.text().catch(() => '')
      throw new Error(`Couldn't read the file (${lookup.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
    const { sha } = (await lookup.json()) as { sha?: string }
    const res = await fetch(contentsUrl(repo, path), {
      method: 'DELETE',
      headers: headers(token),
      body: JSON.stringify({ message: `Delete ${path}`, sha, branch }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Delete failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
  },
}
