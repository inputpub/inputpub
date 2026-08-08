import { activeVaultInstance, currentVaultFile, vaultCtxFor, withWriteLock } from './vault'

// Images pasted into a note are committed to the vault beside it, and the note
// links to them by *relative* path (`../assets/foo.png`). That keeps a note
// self-contained: it renders the same in Obsidian, in GitHub's own Markdown
// view, and here — and it works for private repos, where an absolute raw URL
// would need a credential the reader doesn't have.
//
// The cost is that a relative path means nothing to an <img> in the browser,
// so the editor resolves each one through `resolveVaultImage` for display
// only (Crepe's `proxyDomURL`), never writing the resolved URL back into the
// document.

/** Where new attachments are committed, per vault. One folder keeps them
 *  together rather than scattered beside every note. Named for assets, not
 *  images, since video lands here too — and deliberately without a leading
 *  dot: Jekyll excludes dotfiles, so a repo published through GitHub Pages
 *  would serve a note whose every image 404s. Changing it only steers new
 *  uploads — notes link relatively, so what's already committed keeps
 *  resolving wherever it sits. */
const DEFAULT_ASSET_DIR = 'assets'

function assetDir(instanceId: string): string {
  const configured = (vaultCtxFor(instanceId).getConfig('assetDir') ?? '').trim()
  return configured.replace(/^\/+|\/+$/g, '') || DEFAULT_ASSET_DIR
}

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
 *  links to `../assets/x.png` rather than a root-absolute path Obsidian and
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
// The same URLs once they've actually arrived. resolveVaultImage has to answer
// synchronously to avoid a broken image (see its comment), and a settled
// promise can't be read synchronously — so the value is kept here too.
const settled = new Map<string, string>()
const objectUrls = new Set<string>()

const keyFor = (instanceId: string, path: string) => `${instanceId}:${path}`

function track(key: string, url: string): string {
  objectUrls.add(url)
  settled.set(key, url)
  return url
}

/** Drop every resolved URL. Called when the vault changes or the editor goes
 *  away — object URLs pin their blob in memory until revoked. */
export function releaseVaultImages(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
  cache.clear()
  settled.clear()
}

// Uploads happen inside the editor, where the file tree can't see them, so it
// would keep showing an asset folder without the image just added to it.
const uploadListeners = new Set<(path: string) => void>()

/** Subscribe to images committed from the editor. Returns an unsubscribe. */
export function onVaultImageUploaded(fn: (path: string) => void): () => void {
  uploadListeners.add(fn)
  return () => {
    uploadListeners.delete(fn)
  }
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
  const path = `${assetDir(active.id)}/${uniqueName(file.name)}`
  const bytes = await file.arrayBuffer()
  await withWriteLock(() => active.provider.writeBinary(vaultCtxFor(active.id), path, bytes))
  // Show it from the bytes we already hold rather than reading it back: right
  // after a commit GitHub can still serve the pre-write tree, so a re-read here
  // is both slower and liable to 404.
  const key = keyFor(active.id, path)
  cache.set(key, Promise.resolve(track(key, URL.createObjectURL(file))))
  for (const fn of uploadListeners) fn(path)
  return relativeFrom(dirOf(notePath), path)
}

/** An object URL for a file at a *repo* path — for previewing something picked
 *  in the sidebar, where the path is already absolute rather than relative to
 *  some note. Shares the cache with the editor's own image rendering. */
export function vaultFileObjectUrl(path: string): Promise<string> {
  const active = activeVaultInstance()
  if (!active) return Promise.reject(new Error('No vault connected'))
  const key = keyFor(active.id, path)
  const hit = cache.get(key)
  if (hit) return hit
  const pending = active.provider
    .readBinary(vaultCtxFor(active.id), path)
    .then((blob) => track(key, URL.createObjectURL(blob)))
    .catch((err) => {
      cache.delete(key)
      throw err
    })
  cache.set(key, pending)
  return pending
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
  // Already downloaded: hand back the URL itself, not a promise. Crepe assigns
  // a string straight to the <img>, but for a promise it leaves the original
  // src in place until it resolves — and that src is a repo-relative path,
  // which the browser dutifully requests from this origin, 404s, and draws as a
  // broken image. Anything already in hand must therefore answer synchronously.
  const done = settled.get(key)
  if (done) return done
  const hit = cache.get(key)
  if (hit) return hit

  const pending = active.provider
    .readBinary(vaultCtxFor(active.id), path)
    .then((blob) => track(key, URL.createObjectURL(blob)))
    .catch(() => {
      // Leave a missing image broken rather than cached as broken — the file
      // may simply not have been committed yet.
      cache.delete(key)
      return src
    })
  cache.set(key, pending)
  return pending
}

/** Every image a note links to, as the raw link text found in the source. The
 *  `<...>` branch is Markdown's escape for paths containing spaces — the form
 *  Obsidian writes — which the bare branch would cut at the first space.
 *
 *  Only ever used to decide what to prefetch, so a miss costs a read that gets
 *  discarded and an image that resolves the slow way, never a wrong render. */
function imageLinks(markdown: string): string[] {
  const links = new Set<string>()
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))/g)) {
    links.add(m[1] ?? m[2])
  }
  for (const m of markdown.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)) links.add(m[1])
  return [...links]
}

/** Download a note's images before it's handed to the editor, so they're in
 *  hand when it mounts and resolveVaultImage can answer synchronously — which
 *  is what keeps them from rendering broken first.
 *
 *  Gives up after `timeoutMs` and lets the note through regardless: a slow or
 *  image-heavy note shouldn't hold its own text hostage, and an image that
 *  arrives late just resolves the way it always did. A link that isn't a vault
 *  image costs nothing here — resolveVaultImage hands those straight back. */
export async function warmVaultImages(markdown: string, timeoutMs = 2000): Promise<void> {
  const links = imageLinks(markdown)
  if (!links.length) return
  const all = Promise.allSettled(links.map((src) => resolveVaultImage(src)))
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
