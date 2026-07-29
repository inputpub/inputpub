import { useEffect, useState } from 'react'
import type { VaultConnectProps } from './types'
import { ghGet } from './github'
import { GitHubIcon } from '../destinations/icons'
import { isGithubOAuthConfigured, loginWithGitHub } from '../lib/githubOAuth'
import { clearGithubToken, getGithubToken, setGithubToken } from '../lib/storage'

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
const linkBtn = 'cursor-pointer bg-transparent p-0 text-[0.78rem] text-accent underline'

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
export function GithubConnect({ ctx, onComplete, onCancel, cancelLabel = 'Cancel' }: VaultConnectProps) {
  const oauth = isGithubOAuthConfigured()
  // A new instance with no token of its own falls back to the shared login, so
  // "logged in" is simply "there is a token".
  const [token, setToken] = useState(() => (ctx.getConfig('token') ?? '').trim() || getGithubToken() || '')
  const [repos, setRepos] = useState<RepoOption[] | null>(null)
  const [repo, setRepo] = useState(() => (ctx.getConfig('repo') ?? '').trim())
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

  // On mount, if we already have a token, load its repos.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) void loadRepos(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login() {
    setBusy(true)
    setError(null)
    try {
      const t = await loginWithGitHub()
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

  function reconnect() {
    clearGithubToken() // forget the shared login so a new one is required
    ctx.setConfig('token', '')
    setToken('')
    setRepos(null)
    setRepo('')
  }

  async function finish(fullName: string) {
    if (!fullName) return
    ctx.setConfig('token', token)
    ctx.setConfig('repo', fullName)
    setGithubToken(token)
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

  const header = (
    <div className="flex items-center gap-[0.5rem] text-[0.86rem] font-medium">
      <span className="inline-flex text-[1.1rem] leading-none [&_svg]:block [&_svg]:size-[1em]">
        {GitHubIcon}
      </span>
      <span>GitHub</span>
    </div>
  )

  // No token yet → log in.
  if (!token) {
    return (
      <div className="flex flex-col gap-[0.7rem] p-[0.7rem]">
        {header}
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
      {header}
      <div className="flex flex-col gap-[0.4rem]">
        <label className="text-[0.78rem] text-muted">Repository</label>
        <div className="flex items-center gap-2">
          <select
            className={`${fieldCls} min-w-0 flex-1`}
            value={repo}
            disabled={repos === null || empty}
            onChange={(e) => setRepo(e.target.value)}
          >
            <option value="">
              {repos === null ? 'Loading…' : empty ? 'No repositories granted' : 'Select a repository…'}
            </option>
            {(repos ?? []).map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName}
                {r.private ? ' (private)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Refresh repositories"
            className="shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-2 text-muted hover:text-text disabled:cursor-default disabled:opacity-50 [&_svg]:block [&_svg]:size-[1em]"
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
            You didn’t grant access to any repository. Use “Add or change repositories” below (or
            create one first), then refresh.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" className={linkBtn} disabled={busy} onClick={() => void login()}>
            Add or change repositories
          </button>
          <a className={linkBtn} href="https://github.com/new" target="_blank" rel="noreferrer">
            New repository on GitHub ↗
          </a>
          <button type="button" className={linkBtn} onClick={reconnect}>
            Use a different account
          </button>
        </div>
        <div className="mt-[0.4rem] flex justify-end gap-2">
          {onCancel && (
            <button type="button" className={ghostBtn} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button type="button" className={primaryBtn} disabled={busy || !repo} onClick={() => void finish(repo)}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
      {error && <p className="m-0 text-[0.78rem] text-[#e5484d]">{error}</p>}
    </div>
  )
}
