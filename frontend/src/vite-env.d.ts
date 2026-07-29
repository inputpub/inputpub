/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** GitHub App slug (from its URL) — enables "Login with GitHub" for the
   *  vault via the app's install/repo-picker flow. */
  readonly VITE_GITHUB_APP_SLUG?: string
  /** URL of the token-exchange Worker (see oauth-proxy/). */
  readonly VITE_GITHUB_OAUTH_WORKER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
