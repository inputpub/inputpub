import type { VaultContext, VaultEntry, VaultProvider } from './types'
import { VaultConflictError } from './types'
import { GitHubIcon } from '../destinations/icons'
import { GithubConnect } from './GithubConnect'

/** Encode a UTF-8 string to base64 (btoa alone breaks on non-Latin1, e.g. CJK). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Base64 for raw bytes. Chunked because btoa needs a binary string, and
 *  spreading a whole image's worth of bytes at once overflows the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
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

/** Asks GitHub for the repo's default branch, confirming along the way that the
 *  repo exists and is reachable with this token. */
async function fetchDefaultBranch(repo: string, token: string): Promise<string> {
  const res = await ghGet(`https://api.github.com/repos/${repo}`, token)
  if (res.status === 404) {
    throw new Error(
      `Repository "${repo}" wasn't found. Create it on GitHub first, then check the name and that your token can access it.`,
    )
  }
  if (!res.ok) throw new Error(`Couldn't read the repo (${res.status})`)
  const data = (await res.json()) as { default_branch?: string }
  return data.default_branch || 'main'
}

// Every read and write below starts by working out which branch it's on, so an
// unconditional lookup here is a round trip added to all of them — the one
// that used to sit in front of the very first file read on launch. The answer
// is a repo's default branch, which changes about never, so it's remembered
// per instance (keyed by repo, in case the vault is re-pointed) and re-fetched
// only when something downstream turns out not to be there. A branch the user
// configured explicitly needs no lookup at all.
const BRANCH_CACHE_KEY = 'branchCache'

function cachedBranch(ctx: VaultContext, repo: string): string | undefined {
  try {
    const raw = ctx.getConfig(BRANCH_CACHE_KEY)
    if (!raw) return undefined
    const rec = JSON.parse(raw) as { repo?: string; branch?: string }
    if (rec.repo === repo && typeof rec.branch === 'string' && rec.branch) return rec.branch
  } catch {
    /* unreadable — treat as a miss */
  }
  return undefined
}

/** Forgets the remembered default branch, so the next resolve asks GitHub
 *  again. Called when a read fails in a way a stale branch would explain. */
function forgetBranch(ctx: VaultContext): void {
  ctx.setConfig(BRANCH_CACHE_KEY, '')
}

/** Resolves which branch to work against — the configured one, or the repo's
 *  default (remembered between sessions, see above). */
async function resolveBranch(ctx: VaultContext, repo: string, token: string): Promise<string> {
  const configured = (ctx.getConfig('branch') ?? '').trim()
  if (configured) return configured
  const cached = cachedBranch(ctx, repo)
  if (cached) return cached
  const branch = await fetchDefaultBranch(repo, token)
  ctx.setConfig(BRANCH_CACHE_KEY, JSON.stringify({ repo, branch }))
  return branch
}

function contentsUrl(repo: string, path: string, ref?: string): string {
  const base = `https://api.github.com/repos/${repo}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base
}

/** GitHub's trees API refuses a repo that has no commit yet — a fresh repo
 *  created with no README — with 409 "Git Repository is empty.". That's a
 *  fine state for a vault to start from, so rather than erroring, seed the
 *  repo with an initial commit and read the tree again. */
const EMPTY_REPO_409 = 'Git Repository is empty.'

function isEmptyRepoError(status: number, detail: string): boolean {
  return status === 409 && detail.includes(EMPTY_REPO_409)
}

/** Create the initial commit in an empty repo: a README via the Contents API
 *  (passing `branch`, which makes GitHub create that branch too). The Git
 *  Data endpoints (tree/commit/ref) all refuse writes on an empty repo with
 *  the same 409, so this PUT is the one sanctioned way in. */
async function initEmptyRepo(repo: string, token: string, branch: string): Promise<void> {
  const res = await fetch(contentsUrl(repo, 'README.md'), {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message: 'chore: initialize repository',
      content: toBase64(
        'Initialized by [InputPub](https://inputpub.com) so this repository can hold notes and files.\n',
      ),
      branch,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Couldn't initialize the repository (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
    )
  }
}

/** GET a repo's tree, seeding the repo with an initial commit first if it's
 *  empty (see above). If two tabs race to initialize, the loser's PUT 409s
 *  because the README already exists — that's fine if the re-read succeeds,
 *  so a failed init only surfaces when the re-read still can't load. */
async function treeWithInit(repo: string, token: string, branch: string): Promise<Response> {
  const url = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  const first = await ghGet(url, token)
  if (first.status !== 409) return first
  const detail = await first.text().catch(() => '')
  if (!isEmptyRepoError(first.status, detail)) return first
  try {
    await initEmptyRepo(repo, token, branch)
  } catch (initErr) {
    const retry = await ghGet(url, token)
    if (retry.ok) return retry
    throw initErr
  }
  return ghGet(url, token)
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
    if (!refRes.ok) {
      const detail = await refRes.text().catch(() => '')
      // An empty repo has no ref at all; the tree readers seed one on their
      // own, but guard here too so a move can't trip over the 409 first.
      if (attempt === 0 && isEmptyRepoError(refRes.status, detail)) {
        await initEmptyRepo(repo, token, branch).catch(() => {})
        continue
      }
      throw new Error(
        `Couldn't read the branch (${refRes.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
      )
    }
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
      key: 'assetDir',
      label: 'Asset folder',
      placeholder: 'assets',
      optional: true,
      hint: 'Where pasted images and video are committed. Only affects new ones — notes link to them by relative path, so what is already in the repo keeps working wherever it is.',
    },
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

  /** The branch head: one small request that changes if and only if something
   *  in the repo was committed. Nothing here is worth failing an operation
   *  over — a repo with no commits yet has no ref at all — so an unreadable
   *  head just reads as "can't say". */
  async revision(ctx) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await ghGet(
      `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as { object?: { sha?: string } }
    return data.object?.sha
  },

  async listTree(ctx) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await treeWithInit(repo, token, branch)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // A branch that isn't there is exactly what a remembered one going stale
      // looks like (the repo was re-pointed, the default branch renamed), and
      // the tree is the first thing every session reads — so let the miss clear
      // it and heal the next load.
      if (res.status === 404) forgetBranch(ctx)
      throw new Error(
        `Couldn't load the repo tree (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`,
      )
    }
    const data = (await res.json()) as { tree?: { path: string; type: string; sha?: string }[] }
    const entries: VaultEntry[] = []
    for (const item of data.tree ?? []) {
      if (item.type === 'tree') entries.push({ path: item.path, type: 'dir' })
      else if (item.type === 'blob') entries.push({ path: item.path, type: 'file', sha: item.sha })
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

  async writeBinary(ctx, path, bytes) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    const res = await fetch(contentsUrl(repo, path), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message: `Add ${path}`,
        content: bytesToBase64(new Uint8Array(bytes)),
        branch,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Upload failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
  },

  async readBinary(ctx, path) {
    const { repo, token } = repoAndToken(ctx)
    const branch = await resolveBranch(ctx, repo, token)
    // `.raw` returns the bytes directly. The default JSON representation
    // base64-encodes them and refuses outright over 1MB, which plenty of
    // pasted screenshots exceed.
    const res = await fetch(contentsUrl(repo, path, branch), {
      headers: { ...headers(token), Accept: 'application/vnd.github.raw' },
    })
    if (!res.ok) throw new Error(`Couldn't load the image (${res.status})`)
    return res.blob()
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
    const res = await treeWithInit(repo, token, branch)
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
