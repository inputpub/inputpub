import type { Destination } from './types'

/** Open X's compose window with the content pre-filled — no auth needed. */
export const x: Destination = {
  id: 'x',
  name: 'X',
  icon: '𝕏',
  hint: '280 字符上限，超出请自行精简',
  send(markdown) {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(markdown)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return '已打开 X 发推窗口'
  },
}
