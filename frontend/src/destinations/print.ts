import type { Destination } from './types'

/** Print the rendered sheet via the browser's print dialog.
 *  The on-screen A4 sheet is reused; @media print styles (App.css) strip the
 *  UI chrome and force black-on-white so the output is clean. */
export const print: Destination = {
  id: 'print',
  name: 'Print',
  icon: '🖨️',
  send() {
    window.print()
    return '已打开打印对话框'
  },
}
