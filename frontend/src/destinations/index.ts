import type { Destination } from './types'
import { x } from './x'
import { chatgpt } from './chatgpt'
import { email } from './email'
import { githubGist } from './github-gist'
import { print } from './print'

/** Registry of all publish/send targets. Add a target = add a file + a line here. */
export const destinations: Destination[] = [x, githubGist, email, chatgpt, print]

export type { Destination } from './types'
