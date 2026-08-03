import { activeVaultInstance, currentVaultFile, vaultCtxFor, withWriteLock } from './vault'

// Images pasted into a note are committed to the vault beside it, and the note
// links to them by *relative* path (`../images/foo.png`). That keeps a note
// self-contained: it renders the same in Obsidian, in GitHub's own Markdown
// view, and here — and it works for private repos, where an absolute raw URL
// would need a credential the reader doesn't have.
//
// The cost is that a relative path means nothing to an <img> in the browser,
// so the editor resolves each one through `resolveVaultImage` for display
// only (Crepe's `proxyDomURL`), never writing the resolved URL back into the
// document.

/** One folder at the repo root, rather than files scattered beside each note —
 *  the sidebar hides images (listTree is text-only), so loose ones would be
 *  invisible and easy to orphan. */
const IMAGE_DIR = 'images'

function sanitize(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|-+$/g, '') || 'image'
  )
}

/** Collision-proof, and safe to drop into a Markdown link without escaping. */
function uniqueName(name: string): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitize(name)}`
}

/** The directory a repo path sits in ('' for the repo root). */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

const split = (p: string) => p.split('/').filter((s) => s && s !== '.')

/** Express `to` (a repo path) relative to `fromDir`, so a note in a subfolder
 *  links to `../images/x.png` rather than a root-absolute path Obsidian and
 *  GitHub would each read differently. */
function relativeFrom(fromDir: string, to: string): string {
  const from = split(fromDir)
  const target = split(to)
  let common = 0
  while (common < from.length && common < target.length && from[common] === target[common]) common++
  const ups = from.length - common
  const rest = target.slice(common)
  return [...Array<string>(ups).fill('..'), ...rest].join('/')
}

/** The inverse: turn a link found in a note back into a repo path. */
function resolveFrom(fromDir: string, link: string): string {
  // A leading slash means the repo root, not the filesystem root.
  const parts = link.startsWith('/') ? [] : split(fromDir)
  for (const seg of split(link)) {
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

// Resolved object URLs, keyed by vault instance + repo path so two notes
// referencing the same image share one, and switching vaults can't hand back
// another vault's bytes. Values are promises, which also dedupes the case of
// one image appearing several times in a document.
const cache = new Map<string, Promise<string>>()
const objectUrls = new Set<string>()

const keyFor = (instanceId: string, path: string) => `${instanceId}:${path}`

function track(url: string): string {
  objectUrls.add(url)
  return url
}

/** Drop every resolved URL. Called when the vault changes or the editor goes
 *  away — object URLs pin their blob in memory until revoked. */
export function releaseVaultImages(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
  cache.clear()
}

/** Images need a repo to live in *and* an open note to be relative to, so this
 *  is false while editing the local draft. */
export function canUploadVaultImages(): boolean {
  return !!activeVaultInstance() && currentVaultFile() !== undefined
}

/** Commit an image to the vault; returns the link to put in the note. */
export async function uploadVaultImage(file: File): Promise<string> {
  const active = activeVaultInstance()
  const notePath = currentVaultFile()
  if (!active || notePath === undefined) {
    throw new Error('Open a file in your repo first — images are saved next to it.')
  }
  const path = `${IMAGE_DIR}/${uniqueName(file.name)}`
  const bytes = await file.arrayBuffer()
  await withWriteLock(() => active.provider.writeBinary(vaultCtxFor(active.id), path, bytes))
  // Show it from the bytes we already hold rather than reading it back: right
  // after a commit GitHub can still serve the pre-write tree, so a re-read here
  // is both slower and liable to 404.
  cache.set(keyFor(active.id, path), Promise.resolve(track(URL.createObjectURL(file))))
  return relativeFrom(dirOf(notePath), path)
}

/** The bytes behind a note's image link, as a data: URI — or undefined if the
 *  link isn't a vault image (or can't be read). Goes through resolveVaultImage
 *  so it shares the same cache as the editor's own rendering. */
async function imageAsDataUrl(src: string): Promise<string | undefined> {
  const resolved = await resolveVaultImage(src)
  // Anything else is an absolute URL we left alone, or a read that failed.
  if (!resolved.startsWith('blob:')) return undefined
  const blob = await fetch(resolved)
    .then((r) => r.blob())
    .catch(() => undefined)
  if (!blob) return undefined
  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(blob)
  })
}

/** Rewrite rendered HTML so vault images travel with it, inlined as data: URIs.
 *  WeChat's editor re-hosts whatever it can fetch from an <img src> on paste,
 *  and it can fetch neither a path that only means something inside the repo
 *  nor a private repo's raw URL — but it can read the bytes if they're right
 *  there. Absolute URLs are left alone; WeChat can fetch those itself.
 *
 *  Regex over HTML is fine here specifically because this HTML is ours
 *  (markdownToMpHtml), not arbitrary input. */
export async function inlineVaultImages(html: string): Promise<string> {
  const srcPattern = /(<img\b[^>]*?\ssrc=")([^"]*)(")/gi
  const sources = new Set([...html.matchAll(srcPattern)].map((m) => m[2]))
  if (!sources.size) return html

  const inlined = new Map<string, string>()
  await Promise.all(
    [...sources].map(async (src) => {
      const dataUrl = await imageAsDataUrl(src)
      if (dataUrl) inlined.set(src, dataUrl)
    }),
  )
  if (!inlined.size) return html
  return html.replace(srcPattern, (whole, pre, src, post) => {
    const dataUrl = inlined.get(src)
    return dataUrl ? `${pre}${dataUrl}${post}` : whole
  })
}

/** Turn a note's image link into something an <img> can render. Absolute URLs
 *  are handed back untouched, so links to the wider web keep working. */
export function resolveVaultImage(src: string): string | Promise<string> {
  if (!src || /^([a-z]+:|\/\/)/i.test(src)) return src
  const active = activeVaultInstance()
  const notePath = currentVaultFile()
  if (!active || notePath === undefined) return src

  let path: string
  try {
    path = resolveFrom(dirOf(notePath), decodeURI(src))
  } catch {
    path = resolveFrom(dirOf(notePath), src) // not valid percent-encoding; take it literally
  }
  if (!path) return src

  const key = keyFor(active.id, path)
  const hit = cache.get(key)
  if (hit) return hit

  const pending = active.provider
    .readBinary(vaultCtxFor(active.id), path)
    .then((blob) => track(URL.createObjectURL(blob)))
    .catch(() => {
      // Leave a missing image broken rather than cached as broken — the file
      // may simply not have been committed yet.
      cache.delete(key)
      return src
    })
  cache.set(key, pending)
  return pending
}
