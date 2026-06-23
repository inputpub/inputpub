import type { Destination } from './types'
import { RedditIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * Open Reddit's submit page with the title + body prefilled. Reddit self-posts
 * render Markdown, so by default the body keeps Markdown (minus the H1, which
 * becomes the title). Off by default.
 */
export const reddit: Destination = {
  id: 'reddit',
  name: 'Reddit',
  icon: RedditIcon,
  defaultEnabled: false,
  config: [
    {
      key: 'title',
      label: 'Title template',
      default: '{{ title }}',
      optional: true,
      hint: templateHint,
    },
    {
      key: 'text',
      label: 'Body template',
      type: 'textarea',
      optional: true,
      default: '{{ body | no-title }}',
      hint: templateHint,
    },
  ],
  send(_markdown, ctx) {
    const title = ctx.slot('title') || 'Input Pub'
    const text = ctx.slot('text')
    const url = `https://www.reddit.com/submit?title=${encodeURIComponent(
      title,
    )}&text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened the Reddit submit page'
  },
}
