import type { Destination } from './types'
import { WeChatIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * WeChat's Official Accounts platform has no public posting API, so copy the
 * content and open the editor — the user pastes into a new article. The content
 * is copied as rich text (`format: 'mp-html'`), so it arrives already
 * formatted; external image URLs are fetched and re-hosted by the editor on
 * paste. Off by default.
 */
export const wechat: Destination = {
  id: 'wechat',
  name: 'WeChat MP',
  icon: WeChatIcon,
  defaultEnabled: false,
  clipboard: { url: 'https://mp.weixin.qq.com/', format: 'mp-html' },
  config: [
    {
      key: 'content',
      label: 'Content template',
      type: 'textarea',
      optional: true,
      default: '{{ body | mp-html }}',
      hint: templateHint,
    },
  ],
}
