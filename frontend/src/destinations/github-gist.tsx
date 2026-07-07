import type { Destination } from './types'
import { GistIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * Create a private GitHub Gist using the user's own Personal Access Token,
 * stored locally. GitHub's API supports CORS, so this works without a backend.
 */
export const githubGist: Destination = {
  id: 'github-gist',
  name: 'GitHub Gist',
  icon: GistIcon,
  config: [
    {
      key: 'token',
      label: 'GitHub Token',
      placeholder: 'ghp_…',
      type: 'password',
      hint: (
        <>
          Use a classic token with only the <b>gist</b> scope (fine-grained tokens can't access
          gists yet; this scope can't touch your repositories).{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=gist&description=Input%20Pub%20(gist)"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Create one ↗
          </a>
        </>
      ),
    },
    {
      key: 'description',
      label: 'Description template',
      default: '{{ title }}',
      optional: true,
      hint: templateHint,
    },
    {
      key: 'content',
      label: 'File content template',
      type: 'textarea',
      optional: true,
      default: '{{ body }}',
      hint: templateHint,
    },
  ],
  async send(_markdown, ctx) {
    const token = ctx.getConfig('token')
    if (!token) throw new Error('Missing GitHub token')

    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: ctx.slot('description') || 'Input Pub',
        public: false,
        files: { 'input.md': { content: ctx.slot('content') } },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Couldn't create the gist (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`)
    }

    const data = (await res.json()) as { html_url?: string }
    if (data.html_url) window.open(data.html_url, '_blank', 'noopener,noreferrer')
    return 'Gist created'
  },
}
