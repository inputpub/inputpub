import { useEffect, useState } from 'react'
import type { VaultConnectProps } from './types'
import { ghGet } from './github'
import { GitHubIcon } from '../destinations/icons'
import { isGithubOAuthConfigured, loginWithGitHub, manageRepoAccess } from '../lib/githubOAuth'
import { getGithubToken, setGithubToken } from '../lib/storage'

interface RepoOption {
  fullName: string
  private: boolean
}

const fieldCls =
  'w-full rounded-lg border border-line bg-bg px-[0.6rem] py-2 text-[0.86rem] text-inherit focus:border-accent focus:outline-none'
const primaryBtn =
  'cursor-pointer rounded-md border border-btn-bg bg-btn-bg px-[0.7rem] py-[0.4rem] text-[0.82rem] text-btn-fg disabled:cursor-default disabled:opacity-60'
const ghostBtn =
  'cursor-pointer rounded-md border border-line bg-transparent px-[0.7rem] py-[0.4rem] text-[0.82rem] text-inherit disabled:cursor-default disabled:opacity-60'
const linkBtn =
  'cursor-pointer bg-transparent p-0 text-[0.78rem] text-muted underline decoration-line underline-offset-2 hover:text-text hover:decoration-current disabled:cursor-default disabled:opacity-50'

/** The repos a token can currently access — fetched live every time, never
 *  cached: enumerate the GitHub App's installations and their granted repos. */
async function fetchRepos(token: string): Promise<RepoOption[]> {
  const insRes = await ghGet('https://api.github.com/user/installations?per_page=100', token)
  if (!insRes.ok) throw new Error(`Couldn't read installations (${insRes.status})`)
  const { installations = [] } = (await insRes.json()) as { installations?: { id: number }[] }
  const lists = await Promise.all(
    installations.map(async (i) => {
      const r = await ghGet(`https://api.github.com/user/installations/${i.id}/repositories?per_page=100`, token)
      if (!r.ok) return []
      const { repositories = [] } = (await r.json()) as {
        repositories?: { full_name: string; private: boolean }[]
      }
      return repositories
    }),
  )
  const seen = new Set<string>()
  return lists
    .flat()
    .map((r) => ({ fullName: r.full_name, private: r.private }))
    .filter((o) => (seen.has(o.fullName) ? false : (seen.add(o.fullName), true)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/**
 * GitHub vault connect UI. Which step shows is decided purely by whether we have
 * a token: none → "Login with GitHub" (the App install flow, where the user
 * grants only the repos they choose); have one → pick a repository. The token
 * is shared across GitHub vaults so a second one reuses it; the repos it grants
 * are fetched live (never cached).
 */
export function GithubConnect({
  ctx,
  onComplete,
  configuring,
  onCancel,
  cancelLabel = 'Cancel',
}: VaultConnectProps) {
  const oauth = isGithubOAuthConfigured()
  // A new instance with no token of its own falls back to the shared login, so
  // "logged in" is simply "there is a token".
  const [token, setToken] = useState(() => (ctx.getConfig('token') ?? '').trim() || getGithubToken() || '')
  const [repos, setRepos] = useState<RepoOption[] | null>(null)
  const [repo, setRepo] = useState(() => (ctx.getConfig('repo') ?? '').trim())
  const [branch, setBranch] = useState(() => (ctx.getConfig('branch') ?? '').trim())
  const [autosave, setAutosave] = useState(() => (ctx.getConfig('autosaveSeconds') ?? '').trim())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // All setState is post-await, so this is safe to call from an effect.
  async function loadRepos(tok: string) {
    try {
      const options = await fetchRepos(tok)
      setRepos(options)
      if (options.length === 1) setRepo(options[0].fullName) // one grant → preselect
      setError(null)
    } catch (err) {
      setRepos([])
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // On mount (new-connection flow only), if we already have a token, load its
  // repos. Settings mode doesn't pick a repo, so it skips this.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!configuring && token) void loadRepos(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login() {
    setBusy(true)
    setError(null)
    try {
      // The same query the repo list below runs, so "no repos to pick" and
      // "send them to the picker" can never disagree. On failure say yes:
      // being unable to tell is no reason to force an extra permissions step.
      const t = await loginWithGitHub(async (token) => {
        try {
          return (await fetchRepos(token)).length > 0
        } catch {
          return true
        }
      })
      setGithubToken(t) // share with future vaults
      ctx.setConfig('token', t)
      setToken(t)
      setRepos(null)
      await loadRepos(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Open GitHub's repo-access page; when it closes, just re-list the repos with
  // the current token. Not a login — doesn't touch `busy`/the Connect button,
  // and closing the popup isn't an error.
  async function manage() {
    setError(null)
    try {
      await manageRepoAccess()
      setRepos(null)
      await loadRepos(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function finish(fullName: string) {
    if (!fullName) return
    ctx.setConfig('token', token)
    ctx.setConfig('repo', fullName)
    setGithubToken(token)
    await run()
  }

  // Settings mode: persist this vault's branch / auto-save config.
  async function saveSettings() {
    ctx.setConfig('branch', branch.trim())
    ctx.setConfig('autosaveSeconds', autosave.trim())
    await run()
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onComplete()
      // onComplete switches away from this form; no need to reset busy.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  // Titled per mode: "GitHub" alone said which service, never which task —
  // and login/pick-a-repo are two steps of one task, so they share a title.
  const headerFor = (title: string) => (
    <div className="flex items-center gap-[0.5rem] text-[0.86rem] font-medium">
      <span className="inline-flex text-[1.1rem] leading-none [&_svg]:block [&_svg]:size-[1em]">
        {GitHubIcon}
      </span>
      <span>{title}</span>
    </div>
  )
  const connectRepoHeader = headerFor('Connect a repo')

  // Settings mode (gear on the connected vault): just this vault's config.
  // Repo/account changes and Disconnect live elsewhere (Disconnect is rendered
  // by the host below this form).
  if (configuring) {
    const repoName = (ctx.getConfig('repo') ?? '').trim()
    return (
      <div className="flex flex-col gap-[0.7rem] p-[0.7rem]">
        {headerFor('Repo settings')}
        {repoName && (
          <p className="m-0 truncate text-[0.78rem] text-muted">
            Repository: <span className="text-text">{repoName}</span>
          </p>
        )}
        <label className="text-[0.78rem] text-muted">Branch (optional)</label>
        <input
          className={fieldCls}
          placeholder="default branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
        <label className="text-[0.78rem] text-muted">Auto-save after inactivity (seconds)</label>
        <input
          className={fieldCls}
          type="number"
          min={1}
          placeholder="15"
          value={autosave}
          onChange={(e) => setAutosave(e.target.value)}
        />
        <p className="m-0 text-[0.72rem] leading-snug text-muted">
          Each save is a commit, so edits are batched into one commit per pause rather than one per
          keystroke.
        </p>
        {error && <p className="m-0 text-[0.78rem] text-[#e5484d]">{error}</p>}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button type="button" className={ghostBtn} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void saveSettings()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  // No token yet → log in.
  if (!token) {
    return (
      <div className="flex flex-col gap-[0.7rem] p-[0.7rem]">
        {connectRepoHeader}
        {oauth ? (
          <>
            <p className="m-0 text-[0.78rem] leading-snug text-muted">
              Connect a GitHub repository to keep your files in. You choose which repositories to
              grant — access stays in this browser, never on our servers.
            </p>
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void login()}>
              {busy ? 'Connecting…' : 'Login with GitHub'}
            </button>
          </>
        ) : (
          <p className="m-0 text-[0.78rem] leading-snug text-muted">
            GitHub login isn’t configured for this site.
          </p>
        )}
        {error && <p className="m-0 text-[0.78rem] text-[#e5484d]">{error}</p>}
        {onCancel && (
          <div className="flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Have a token → pick a repository from the ones it can currently access.
  const empty = repos !== null && repos.length === 0
  return (
    <div className="flex flex-col gap-[0.7rem] p-[0.7rem]">
      {connectRepoHeader}
      {/* No "Repository" label — the select's own placeholder already says it.
          pr-7 keeps long repo names clear of the native dropdown arrow. */}
      <div className="flex items-center gap-1">
        <select
          className={`${fieldCls} min-w-0 flex-1 pr-7`}
          value={repo}
          disabled={repos === null || empty}
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="">
            {repos === null ? 'Loading…' : empty ? 'No repositories granted' : 'Select a repo'}
          </option>
          {(repos ?? []).map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.fullName}
              {r.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
        {/* Secondary to the select, so no border of its own — a matching box
            would read as an equal partner to the thing you actually pick from. */}
        <button
          type="button"
          title="Refresh repositories"
          className="shrink-0 cursor-pointer rounded-md bg-transparent p-2 text-muted hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-50 [&_svg]:block [&_svg]:size-[1em]"
          disabled={repos === null}
          onClick={() => {
            setRepos(null)
            void loadRepos(token)
          }}
        >
          <svg
            className={repos === null ? 'animate-spin' : ''}
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      {empty && (
        <p className="m-0 text-[0.78rem] text-muted">
          You didn’t grant access to any repository. Use “Manage repo access” below (or create one
          on GitHub first).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className={linkBtn}
          disabled={repos === null}
          onClick={() => void manage()}
        >
          Manage repo access
        </button>
        <a className={linkBtn} href="https://github.com/new" target="_blank" rel="noreferrer">
          Create repo ↗
        </a>
      </div>
      {/* Above the actions, not after them — an error explaining why Connect
          failed belongs where you look before pressing it again. */}
      {error && <p className="m-0 text-[0.78rem] text-[#e5484d]">{error}</p>}
      <div className="mt-[0.4rem] flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={ghostBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !repo}
          onClick={() => void finish(repo)}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
