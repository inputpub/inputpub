import type { ReactNode } from 'react'

/** Shared hint for every GitHub-token field that talks to a repository
 *  (publish, image host, vault — not gists, which fine-grained tokens don't
 *  support). Tokens live in localStorage, which any script on the page could
 *  read if the app were ever compromised — so steer users toward fine-grained
 *  tokens scoped to a single repo, where a leak exposes one notes repo
 *  instead of their whole account. */
export const githubRepoTokenHint: ReactNode = (
  <>
    Use a <b>fine-grained token</b> limited to just this repository, with{' '}
    <b>Contents: read &amp; write</b> permission — if it ever leaks, only that repo is exposed.{' '}
    <a
      href="https://github.com/settings/personal-access-tokens/new"
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      Create one ↗
    </a>
  </>
)
