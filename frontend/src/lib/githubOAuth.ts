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

/** Runs the popup install/authorize flow; resolves with a user access token.
 *  What the token can access (its repos) is fetched live afterwards, not here. */
export async function loginWithGitHub(): Promise<string> {
  if (!APP_SLUG || !WORKER_URL) throw new Error('GitHub login isn’t configured')
  const state = crypto.randomUUID()
  // The install page is where GitHub lets the user choose which repositories to
  // grant. With "Request user authorization during installation" enabled, it
  // redirects back with a user-auth `code` too.
  const url = `https://github.com/apps/${encodeURIComponent(APP_SLUG)}/installations/new?state=${encodeURIComponent(state)}`

  const popup = window.open(url, 'github-oauth', 'width=640,height=760')
  if (!popup) throw new Error('Popup blocked — allow popups for this site and try again.')

  const code = await waitForCallback(popup, state)
  return exchangeCode(code, WORKER_URL)
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
async function exchangeCode(code: string, workerUrl: string): Promise<string> {
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Token exchange failed (${res.status})`)
  }
  return data.access_token
}
