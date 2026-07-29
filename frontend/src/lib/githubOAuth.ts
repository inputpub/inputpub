// "Login with GitHub" for the GitHub vault, via a GitHub *App* (not an OAuth
// App) so the user grants access to only the repositories they pick. The flow:
// open the app's install page (where GitHub shows the repo picker) → GitHub
// redirects back with a `code` and `installation_id` → a stateless Worker swaps
// the code for a user-to-server token (the one step needing the client secret).
// The token is stored in the browser like any other credential — nothing is
// kept server-side. With token expiration disabled on the App, it doesn't
// expire, so there's no refresh flow.
//
// Configured via build-time env (see frontend/.env.example). When unset, the UI
// falls back to the manual personal-access-token flow.

const APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG
const WORKER_URL = import.meta.env.VITE_GITHUB_OAUTH_WORKER

/** Whether "Login with GitHub" is available (both env vars provided). */
export function isGithubOAuthConfigured(): boolean {
  return !!APP_SLUG && !!WORKER_URL
}

interface CallbackMessage {
  source?: string
  code?: string | null
  state?: string | null
  error?: string | null
}

/** Runs the popup authorize flow; resolves with a user access token. Uses the
 *  Worker's /authorize redirect (GitHub's OAuth authorize endpoint), which
 *  always returns a `code` — including when the App is already installed on the
 *  account (e.g. logging in on a second device). Repo selection is a separate
 *  step (manageRepoAccess); what the token can access is fetched live later. */
export async function loginWithGitHub(): Promise<string> {
  if (!WORKER_URL) throw new Error('GitHub login isn’t configured')
  const state = crypto.randomUUID()
  const redirectUri = `${location.origin}/callback.html`
  const url =
    `${WORKER_URL}/authorize?state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`

  const popup = window.open(url, 'github-oauth', 'width=640,height=760')
  if (!popup) throw new Error('Popup blocked — allow popups for this site and try again.')

  const code = await waitForCallback(popup, state)
  return exchangeCode(code, redirectUri, WORKER_URL)
}

/** Open the GitHub App's install/configure page so the user can add or remove
 *  the repositories it can access. Resolves when the popup closes — no token or
 *  code is involved (the current token already works); the caller just re-lists
 *  repos afterwards. */
export function manageRepoAccess(): Promise<void> {
  if (!APP_SLUG) throw new Error('GitHub login isn’t configured')
  const url = `https://github.com/apps/${encodeURIComponent(APP_SLUG)}/installations/new`
  const popup = window.open(url, 'github-oauth', 'width=640,height=760')
  if (!popup) {
    return Promise.reject(new Error('Popup blocked — allow popups for this site and try again.'))
  }
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll)
        resolve()
      }
    }, 500)
  })
}

/** Waits for the callback page to postMessage the auth code back to us. */
function waitForCallback(popup: Window, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error('Login was cancelled.'))
      }
    }, 500)

    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin) return
      const data = e.data as CallbackMessage
      if (!data || data.source !== 'inputpub-oauth') return
      cleanup()
      if (data.error) return reject(new Error(data.error))
      if (data.state !== expectedState) return reject(new Error('Login state mismatch — please retry.'))
      if (!data.code) {
        return reject(
          new Error('GitHub returned no code — enable “Request user authorization during installation” on the App.'),
        )
      }
      resolve(data.code)
    }

    function cleanup() {
      clearInterval(poll)
      window.removeEventListener('message', onMessage)
      try {
        popup.close()
      } catch {
        /* already closed */
      }
    }

    window.addEventListener('message', onMessage)
  })
}

/** Swaps the auth code for a token via the stateless proxy Worker. */
async function exchangeCode(code: string, redirectUri: string, workerUrl: string): Promise<string> {
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Token exchange failed (${res.status})`)
  }
  return data.access_token
}
