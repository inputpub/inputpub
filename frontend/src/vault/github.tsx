import type { VaultContext, VaultEntry, VaultProvider } from './types'
import { TEXT_EXT, VaultConflictError } from './types'
import { GitHubIcon } from '../destinations/icons'
import { GithubConnect } from './GithubConnect'

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

export function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
}

/** GET a GitHub API URL, bypassing the browser's HTTP cache. GitHub sends
 *  `Cache-Control: private, max-age=60` on authenticated reads, so a plain
 *  fetch can hand back a stale ref/tree for up to a minute after a write — e.g.
 *  the branch head right after a previous move, which then makes the next
 *  move's ref update fail as a non-fast-forward. */
export function ghGet(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: headers(token), cache: 'no-store' })
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
  const res = await ghGet(`https://api.github.com/repos/${repo}`, token)
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
 * Rename/move a file or a whole directory in one commit via the Git Data API.
 * `from` matches either an exact blob (file) or a path prefix (directory); the
 * blobs are re-pointed to `to` by sha — never downloaded — so binary files
 * (images, PDFs) move intact and the whole thing is a single atomic commit.
 */
async function gitMove(ctx: VaultContext, from: string, to: string): Promise<void> {
  const { repo, token } = repoAndToken(ctx)
  const branch = await resolveBranch(ctx, repo, token)
  const h = headers(token)
  const api = `https://api.github.com/repos/${repo}`
  const ref = `heads/${encodeURIComponent(branch)}`
  const prefix = `${from}/`
  const destFor = (path: string) => (path === from ? to : `${to}/${path.slice(prefix.length)}`)

  // The branch head can advance under us mid-move — most often the app's own
  // autosave landing as a commit — which makes the ref update a non-fast-forward
  // ("Update is not a fast forward"). Rebuild on the fresh head and retry rather
  // than force-pushing (which would drop that concurrent commit).
  for (let attempt = 0; ; attempt++) {
    const refRes = await ghGet(`${api}/git/ref/${ref}`, token)
    if (!refRes.ok) throw new Error(`Couldn't read the branch (${refRes.status})`)
    const commitSha = ((await refRes.json()) as { object?: { sha?: string } }).object?.sha
    if (!commitSha) throw new Error('Unexpected response reading the branch')

    const commitRes = await ghGet(`${api}/git/commits/${commitSha}`, token)
    if (!commitRes.ok) throw new Error(`Couldn't read the commit (${commitRes.status})`)
    const baseTree = ((await commitRes.json()) as { tree?: { sha?: string } }).tree?.sha
    if (!baseTree) throw new Error('Unexpected response reading the commit')

    const treeRes = await ghGet(`${api}/git/trees/${baseTree}?recursive=1`, token)
    if (!treeRes.ok) throw new Error(`Couldn't read the repo tree (${treeRes.status})`)
    const tree = ((await treeRes.json()) as {
      tree?: { path: string; type: string; mode: string; sha: string }[]
    }).tree ?? []

    const blobs = tree.filter((i) => i.type === 'blob')
    const moving = blobs.filter((b) => b.path === from || b.path.startsWith(prefix))
    if (moving.length === 0) throw new Error(`"${from}" wasn't found`)
    const existing = new Set(blobs.map((b) => b.path))
    for (const b of moving) {
      if (existing.has(destFor(b.path))) throw new Error(`"${destFor(b.path)}" already exists`)
    }

    // Re-point each moved blob to its new path and drop the old one (sha: null).
    // Every tree entry — including the deletion — must carry mode + type, or the
    // create-tree API rejects it with "Must supply a valid tree.mode".
    const changes = moving.flatMap((b) => [
      { path: destFor(b.path), mode: b.mode, type: 'blob' as const, sha: b.sha },
      { path: b.path, mode: b.mode, type: 'blob' as const, sha: null },
    ])
    const newTreeRes = await fetch(`${api}/git/trees`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ base_tree: baseTree, tree: changes }),
    })
    if (!newTreeRes.ok) {
      const detail = await newTreeRes.text().catch(() => '')
      throw new Error(`Rename failed (${newTreeRes.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
    const newTree = ((await newTreeRes.json()) as { sha?: string }).sha
    if (!newTree) throw new Error('Unexpected response building the tree')

    const message = moving.length === 1 && moving[0].path === from ? `Rename ${from} → ${to}` : `Rename ${from}/ → ${to}/`
    const newCommitRes = await fetch(`${api}/git/commits`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ message, tree: newTree, parents: [commitSha] }),
    })
    if (!newCommitRes.ok) throw new Error(`Rename failed (${newCommitRes.status})`)
    const newCommit = ((await newCommitRes.json()) as { sha?: string }).sha
    if (!newCommit) throw new Error('Unexpected response creating the commit')

    const patchRes = await fetch(`${api}/git/refs/${ref}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ sha: newCommit }),
    })
    if (patchRes.ok) return
    const detail = await patchRes.text().catch(() => '')
    // Non-fast-forward means the head moved — rebuild on it and retry a few times.
    if (patchRes.status === 422 && /fast.forward/i.test(detail) && attempt < 3) continue
    throw new Error(`Rename failed (${patchRes.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
  }
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
  addLabel: 'Add a repository',
  connectNote:
    'Your token is saved only in this browser (localStorage) and sent straight to GitHub — never to our servers.',
  batchWrites: { defaultDelaySeconds: 15, delayConfigKey: 'autosaveSeconds' },
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      type: 'password',
      placeholder: 'github_pat_…',
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
      placeholder: '15',
      optional: true,
      hint: 'Saves are commits, so edits are batched into one commit per pause instead of one per keystroke.',
    },
  ],

  ConnectForm: GithubConnect,

  label(ctx) {
    return ctx.getConfig('repo')?.trim() || undefined
  },

  async listTree(ctx) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await ghGet(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
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
    const res = await ghGet(contentsUrl(repo, path, branch), token)
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
    const lookup = await ghGet(contentsUrl(repo, path, branch), token)
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

  async deleteDir(ctx, path) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    // The tree lists *every* blob (not just the text files the sidebar shows),
    // so this also removes images/PDFs that would otherwise keep the folder
    // alive — git has no empty directories.
    const res = await ghGet(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token,
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Couldn't load the repo tree (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
      )
    }
    const data = (await res.json()) as { tree?: { path: string; type: string; sha: string }[] }
    const prefix = `${path}/`
    const blobs = (data.tree ?? []).filter((i) => i.type === 'blob' && i.path.startsWith(prefix))
    // Each delete is its own commit (the Contents API is one file at a time);
    // reuse the sha the tree already gave us instead of a lookup per file.
    for (const blob of blobs) {
      const del = await fetch(contentsUrl(repo, blob.path), {
        method: 'DELETE',
        headers: headers(token),
        body: JSON.stringify({ message: `Delete ${blob.path}`, sha: blob.sha, branch }),
      })
      if (!del.ok) {
        const detail = await del.text().catch(() => '')
        throw new Error(
          `Delete failed for ${blob.path} (${del.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
        )
      }
    }
  },

  async moveFile(ctx, from, to) {
    await gitMove(ctx, from, to)
  },

  async moveDir(ctx, from, to) {
    await gitMove(ctx, from, to)
  },
}
