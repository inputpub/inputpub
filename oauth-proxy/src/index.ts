// Minimal, stateless GitHub OAuth token-exchange proxy for Input Pub.
//
// The only thing that can't live in the static frontend is the OAuth *client
// secret* (needed to swap the authorization `code` for an access token). This
// Worker holds that secret and does nothing else: it takes a `code`, calls
// GitHub, and returns the token to the browser. It never stores the token (or
// anything) — the token lives only in the user's browser, exactly like the
// personal-access-token flow it replaces.
//
// Setup: see ./README.md.

export interface Env {
  /** OAuth App client id (public — could be in the frontend, kept here too). */
  GITHUB_CLIENT_ID: string
  /** OAuth App client secret — set with `wrangler secret put`. */
  GITHUB_CLIENT_SECRET: string
  /** Comma-separated origins allowed to call this Worker (CORS + a hard gate),
   *  e.g. "https://inputpub.com,http://localhost:5173". */
  ALLOWED_ORIGINS: string
}

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  if (!allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const cors = corsHeaders(origin, allowed)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    // Only known origins may use our secret to mint tokens.
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 })
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors })
    }

    let body: { code?: string; redirect_uri?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, cors)
    }
    if (!body.code) return json({ error: 'Missing "code"' }, 400, cors)

    const ghRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: body.code,
        redirect_uri: body.redirect_uri,
      }),
    })
    const data = (await ghRes.json().catch(() => ({}))) as {
      access_token?: string
      scope?: string
      token_type?: string
      error?: string
      error_description?: string
    }
    if (!ghRes.ok || data.error || !data.access_token) {
      return json({ error: data.error_description || data.error || 'Token exchange failed' }, 400, cors)
    }
    // Pass the token straight back to the browser; nothing is persisted here.
    return json({ access_token: data.access_token, scope: data.scope }, 200, cors)
  },
}
