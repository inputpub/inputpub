import type { VaultContext, VaultEntry, VaultProvider } from './types'
import { TEXT_EXT, VaultConflictError } from './types'
import { GitHubIcon } from '../destinations/icons'
import { deriveTitle } from '../lib/title'

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

/** Creates `repo` (under a user or an org, whichever `owner` turns out to be)
 *  with an initial commit, so it has a real default branch to work against. */
async function createRepo(owner: string, name: string, token: string): Promise<{ default_branch?: string }> {
  const ownerRes = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, {
    headers: headers(token),
  })
  if (!ownerRes.ok) throw new Error(`GitHub account "${owner}" wasn't found`)
  const ownerData = (await ownerRes.json()) as { type?: string }
  const createUrl =
    ownerData.type === 'Organization'
      ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`
      : 'https://api.github.com/user/repos'

  const res = await fetch(createUrl, {
    method: 'POST',
    headers: headers(token),
    // auto_init so the repo starts with a commit (and thus a real default
    // branch) instead of being empty, which the Trees API can't list.
    body: JSON.stringify({ name, private: true, auto_init: true }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Couldn't create the repo (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
  }
  return res.json()
}

/** Confirms `repo` exists (creating it if it doesn't) and resolves which
 *  branch to work against — the configured one, or the repo's default. */
async function ensureRepoAndBranch(ctx: VaultContext, repo: string, token: string): Promise<string> {
  const [owner, name] = repo.split('/')
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(token) })
  let data: { default_branch?: string }
  if (res.ok) {
    data = await res.json()
  } else if (res.status === 404) {
    data = await createRepo(owner, name, token)
  } else {
    throw new Error(`Couldn't read the repo (${res.status})`)
  }
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
 * Browse and edit files in a GitHub repository via the Contents/Trees API,
 * using the user's own Personal Access Token (repo scope) — the same
 * mechanism as the GitHub publish destination, just kept as its own token so
 * a vault repo can differ from the publish target.
 */
export const githubVault: VaultProvider = {
  id: 'github',
  name: 'GitHub',
  icon: GitHubIcon,
  blurb: 'Store your files in a GitHub repository — works on any device, needs a free GitHub account.',
  batchWrites: true,
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'ghp_…',
      hint: (
        <>
          Use a classic token with the <b>repo</b> scope (the same token you use for GitHub
          publishing works here too).{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=Input%20Pub%20(vault)"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Create one ↗
          </a>
        </>
      ),
    },
    {
      key: 'repo',
      label: 'Repository (owner/repo)',
      placeholder: 'timqian/notes',
      hint: "Created automatically as a private repo if it doesn't exist yet.",
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
    const branch = await ensureRepoAndBranch(ctx, repo, token)
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
    const data = (await res.json()) as { tree?: { path: string; type: string; sha: string }[] }
    const entries: VaultEntry[] = []
    for (const item of data.tree ?? []) {
      if (item.type === 'tree') entries.push({ path: item.path, type: 'dir' })
      else if (item.type === 'blob' && TEXT_EXT.test(item.path))
        entries.push({ path: item.path, type: 'file', sha: item.sha })
    }
    return entries
  },

  async readFile(ctx, path) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await ensureRepoAndBranch(ctx, repo, token)
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
    const branch = await ensureRepoAndBranch(ctx, repo, token)
    const res = await fetch(contentsUrl(repo, path), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} ${path} — ${deriveTitle(content) || 'Input Pub'}`,
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

  async deleteFile(ctx, path, sha) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await ensureRepoAndBranch(ctx, repo, token)
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
