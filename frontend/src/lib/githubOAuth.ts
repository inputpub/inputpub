// "Login with GitHub" for the GitHub vault, via a GitHub *App* (not an OAuth
// App) so the user grants access to only the repositories they pick.
//
// Authorizing the App and installing it on repositories are two separate things
// on GitHub, and the flow has to cope with either one being done already:
//   - The install page shows the repo picker, but for an account that already
//     has the App it renders a "configure" page and never redirects back with a
//     code, so the popup dead-ends.
//   - The OAuth authorize endpoint always returns a code, but hands back a
//     working token with no installation at all for anyone who has authorized
//     before — leaving them connected with nothing to connect *to*.
// So: authorize first (always yields a code), then, only if the token turns out
// to see no installation, carry the user on to the install page in the same
// popup. A stateless Worker swaps the code for a user-to-server token (the one
// step needing the client secret). The token is stored in the browser like any
// other credential — nothing is kept server-side. With token expiration
// disabled on the App, it doesn't expire, so there's no refresh flow.
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

const installUrl = (slug: string, state?: string) =>
  `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` +
  (state ? `?state=${encodeURIComponent(state)}` : '')

function openPopup(url: string): Window {
  const popup = window.open(url, 'github-oauth', 'width=640,height=760')
  if (!popup) throw new Error('Popup blocked — allow popups for this site and try again.')
  return popup
}

function closeQuietly(popup: Window): void {
  try {
    popup.close()
  } catch {
    /* already closed */
  }
}

/** Runs the popup authorize flow; resolves with a user access token.
 *
 *  `hasRepoAccess` is asked once the token exists, and when it answers false
 *  the same popup carries on to the App's install page — so someone who
 *  authorized without granting any repository picks one there and then,
 *  instead of landing on an empty repo list with no idea what to do.
 *
 *  The caller supplies that check so it can run the very same query the repo
 *  list does: "has an installation" isn't the same question, since authorizing
 *  can leave an installation with no repositories selected. */
export async function loginWithGitHub(
  hasRepoAccess?: (token: string) => Promise<boolean>,
): Promise<string> {
  if (!WORKER_URL) throw new Error('GitHub login isn’t configured')
  const state = crypto.randomUUID()
  const redirectUri = `${location.origin}/callback.html`
  const popup = openPopup(
    `${WORKER_URL}/authorize?state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`,
  )
  try {
    const code = await waitForCallback(popup, state)
    const token = await exchangeCode(code, redirectUri, WORKER_URL)
    if (APP_SLUG && hasRepoAccess && !(await hasRepoAccess(token))) {
      // Reusing this window rather than opening another: by now the click that
      // started all this is long over, and a fresh popup would be blocked.
      popup.location.href = installUrl(APP_SLUG, state)
      await waitForPopupDone(popup)
    }
    return token
  } finally {
    closeQuietly(popup)
  }
}

/** Open the GitHub App's install/configure page so the user can add or remove
 *  the repositories it can access. Resolves once they're done — no token or
 *  code is involved (the current token already works); the caller just re-lists
 *  repos afterwards. */
export async function manageRepoAccess(): Promise<void> {
  if (!APP_SLUG) throw new Error('GitHub login isn’t configured')
  const popup = openPopup(installUrl(APP_SLUG))
  try {
    await waitForPopupDone(popup)
  } finally {
    closeQuietly(popup)
  }
}

/** Waits for the install popup to finish: either GitHub redirects it back to
 *  our callback page, or the user closes it. Leaves closing to the caller. */
function waitForPopupDone(popup: Window): Promise<void> {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (popup.closed) {
        cleanup()
        resolve()
      }
    }, 500)

    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin) return
      if ((e.data as CallbackMessage)?.source !== 'inputpub-oauth') return
      cleanup()
      resolve()
    }

    function cleanup() {
      clearInterval(poll)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
  })
}

/** Waits for the callback page to postMessage the auth code back to us. Leaves
 *  the popup open — login may still send it on to the repo picker; the caller
 *  closes it either way. */
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
