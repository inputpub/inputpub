# Input Pub — GitHub OAuth proxy

A tiny, **stateless** Cloudflare Worker whose only job is to exchange a GitHub
OAuth `code` for an access token (the one step that needs the client *secret*,
which can't live in a static site). It stores nothing — the token goes straight
back to the browser and lives only there, same as the old personal-access-token
flow.

## One-time setup

### 1. Create a GitHub App

We use a **GitHub App** (not an OAuth App) so users grant access to only the
repositories they pick, instead of all their repos.

<https://github.com/settings/apps> → **New GitHub App**

- **Homepage URL:** `https://inputpub.com`
- **Callback URL:** `https://inputpub.com/callback.html`
  (add `http://localhost:5173/callback.html` as a second callback for local dev)
- ✅ **Request user authorization (OAuth) during installation** — so installing
  returns a user token `code`.
- ❌ **Expire user authorization tokens** — turn this *off* so tokens don't
  expire (no refresh flow, still nothing stored server-side).
- **Where can this GitHub App be installed?** Any account.
- **Permissions → Repository:**
  - **Contents:** Read and write (read/write the Markdown files)
  - **Metadata:** Read-only (mandatory)
  - nothing else — this is the whole point (least privilege, per-repo).

Note the **Client ID** and the app **slug** (the name in its URL,
`github.com/apps/<slug>`), then **generate a client secret**.

> Creating repositories isn't possible with per-repo access (it's an
> account-level action needing broad admin rights), so the app links users to
> `github.com/new` instead — they create the repo, then grant it.

### 2. Deploy the Worker

```bash
cd oauth-proxy
npm install
npx wrangler secret put GITHUB_CLIENT_ID       # paste the Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET    # paste the client secret
# edit ALLOWED_ORIGINS in wrangler.jsonc if your origins differ
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://inputpub-oauth-proxy.<you>.workers.dev`.

### 3. Point the frontend at it

Set these build-time env vars for the frontend (see `frontend/.env.example`):

```
VITE_GITHUB_APP_SLUG=<the app slug, from github.com/apps/<slug>>
VITE_GITHUB_OAUTH_WORKER=https://inputpub-oauth-proxy.<you>.workers.dev
```

For local dev put them in `frontend/.env.local`; for the deployed site set them
in the GitHub Actions build step (`.github/workflows/deploy.yml`).

If these are unset, the frontend simply falls back to the manual
personal-access-token flow — nothing breaks.

## Local development

Add `http://localhost:5173/callback.html` as a second callback URL on the same
GitHub App (or make a separate dev app). Then:

```bash
cd oauth-proxy
npm install
# local secrets: wrangler auto-loads .dev.vars (gitignored) instead of
# `wrangler secret put`. Create it with:
cat > .dev.vars <<'EOF'
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
EOF
npx wrangler dev            # serves the Worker at http://localhost:8787
```

`ALLOWED_ORIGINS` in `wrangler.jsonc` already includes `http://localhost:5173`,
so the Vite dev server can call it. Then point the frontend at the local Worker
(`frontend/.env.local`):

```
VITE_GITHUB_APP_SLUG=<app slug>
VITE_GITHUB_OAUTH_WORKER=http://localhost:8787
```

and run `cd frontend && npm run dev`.

## What it does / doesn't do

- **Does:** validate the request origin against `ALLOWED_ORIGINS`, call GitHub's
  token endpoint with the secret, return `{ access_token, scope }`.
- **Doesn't:** store tokens, log request bodies, use KV/D1, or keep any state.
