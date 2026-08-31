import {
  clearActiveVaultId,
  clearVaultOpenFile,
  getActiveVaultId,
  getConfig,
  getVaultInstances,
  getVaultOpenFile,
  setActiveVaultId,
  setConfig,
  setVaultInstances,
  setVaultOpenFile,
} from './storage'
import {
  vaultProviders,
  vaultNs,
  VaultConflictError,
  type VaultProvider,
  type VaultEntry,
  type VaultContext,
} from '../vault'
import {
  blobKey,
  cacheDelete,
  cacheDeletePrefix,
  cacheGet,
  cacheSet,
  fileKey,
  instancePrefix,
  treeKey,
  type CachedFile,
  type CachedTree,
} from './vaultCache'

// Drives the connected vault(s) — multi-file stores, currently GitHub repos.
// A provider is a *type* of store; the user can connect
// several independent *instances* of the same type, each with its own
// generated id and its own `vault.<instanceId>` config namespace — see
// vault/types.ts for the provider/instance distinction. Mirrors
// a provider-dispatch layer, plus the state needed to track which
// file is open so saves know its current revision (`sha`).

export interface VaultInstance {
  id: string
  provider: VaultProvider
}

/** Generates a fresh instance id for a new connection of the given provider
 *  type. Not persisted until the connection actually succeeds. */
export function generateVaultInstanceId(providerId: string): string {
  return `${providerId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Adds an instance to the saved list (a no-op if it's already there) —
 *  called once a new connection's config has been validated. */
export function registerVaultInstance(providerId: string, instanceId: string): void {
  const instances = getVaultInstances()
  if (!instances.some((i) => i.id === instanceId)) {
    setVaultInstances([...instances, { id: instanceId, providerId }])
  }
}

/** Every saved instance, resolved to its provider definition (silently
 *  dropping any whose provider type no longer exists). */
export function listVaultInstances(): VaultInstance[] {
  const instances: VaultInstance[] = []
  for (const rec of getVaultInstances()) {
    const provider = vaultProviders.find((p) => p.id === rec.providerId)
    if (provider) instances.push({ id: rec.id, provider })
  }
  return instances
}

export function activeVaultInstance(): VaultInstance | undefined {
  const id = getActiveVaultId()
  if (!id) return undefined
  return listVaultInstances().find((i) => i.id === id)
}

export function vaultCtxFor(instanceId: string): VaultContext {
  return {
    id: instanceId,
    getConfig: (key: string) => getConfig(vaultNs(instanceId), key),
    setConfig: (key: string, value: string) => setConfig(vaultNs(instanceId), key, value),
  }
}

/** An instance can be used once it's ready — by default, once every required
 *  config field has a value, or per the provider's own `isConfigured` check
 *  for providers that connect some other way (e.g. a native picker). */
export function isVaultInstanceConfigured(instanceId: string, provider: VaultProvider): boolean {
  if (provider.isConfigured) return provider.isConfigured(vaultCtxFor(instanceId))
  return provider.config.every((f) => f.optional || getConfig(vaultNs(instanceId), f.key)?.trim())
}

export function isVaultConnected(): boolean {
  return !!activeVaultInstance()
}

/** Whether the active vault should batch edits into occasional saves (as
 *  GitHub does, where every save is a commit) rather than save on every edit.
 *  Kept as a provider capability so a cheap-write store can opt out. */
export function activeVaultBatchesWrites(): boolean {
  return !!activeVaultInstance()?.provider.batchWrites
}

/** Flush any staged edit without surfacing failures — used before changing
 *  what's active (switching files/vaults, disconnecting), where the failure
 *  is already shown via the save-state subscription and shouldn't block. */
async function flushQuietly(): Promise<void> {
  await flushPendingVaultSave().catch(() => {})
}

export async function connectVault(instanceId: string): Promise<void> {
  await flushQuietly()
  // The open file belongs to the vault being left, but both it and the
  // remembered path outlive the switch — which is how a note ends up committed
  // into the wrong repo (a staged edit, or an image pasted right after, targets
  // whichever vault is active *now*), and how the next launch reopens one
  // repo's path against another's. Disconnecting already clears this; switching
  // has to as well.
  clearOpenFile()
  setActiveVaultId(instanceId)
}

/** Disconnects one instance: flushes any pending edit first (if it's the
 *  active one), runs the provider's teardown (if any), drops it from the
 *  saved list, and — if it was the active one — clears that too. */
export async function removeVaultInstance(instanceId: string): Promise<void> {
  if (getActiveVaultId() === instanceId) await flushQuietly()
  const instances = getVaultInstances()
  const rec = instances.find((i) => i.id === instanceId)
  const provider = rec && vaultProviders.find((p) => p.id === rec.providerId)
  if (provider?.disconnect) await provider.disconnect(vaultCtxFor(instanceId))
  dropVaultCache(instanceId)
  setVaultInstances(instances.filter((i) => i.id !== instanceId))
  if (getActiveVaultId() === instanceId) {
    clearActiveVaultId()
    clearOpenFile()
  }
}

/** Disconnects whichever instance is currently active (a no-op if none is). */
export async function disconnectVault(): Promise<void> {
  const active = activeVaultInstance()
  if (active) await removeVaultInstance(active.id)
}

// --- Caching. A vault lives across the network, but it changes far less often
// than it's opened: the same handful of notes, usually untouched since the last
// session. So everything read is kept on disk (lib/vaultCache) and handed back
// immediately on the next launch, while a single cheap request asks the
// provider whether anything moved — and only what actually changed is
// re-read. The freshness rule everywhere below is the same: a cached record
// carries the vault revision it was read at, and it's current exactly while the
// vault still reports that revision.

/** One freshness probe per vault, shared by everything that asks within a few
 *  seconds — on launch that's the tree and the reopened file, which would
 *  otherwise each pay for the same answer. */
let revisionProbe: { id: string; at: number; result: Promise<string | undefined> } | undefined
const REVISION_TTL_MS = 5000
const REVISION_TIMEOUT_MS = 6000

function vaultRevision(instance: VaultInstance): Promise<string | undefined> {
  const { revision } = instance.provider
  if (!revision) return Promise.resolve(undefined)
  const now = Date.now()
  if (revisionProbe && revisionProbe.id === instance.id && now - revisionProbe.at < REVISION_TTL_MS) {
    return revisionProbe.result
  }
  // A probe that fails reads as "can't say", which makes every caller fall back
  // to reading through — never to trusting a cache it couldn't verify.
  const probe = revision(vaultCtxFor(instance.id)).catch(() => undefined)
  // A freshness check must never be able to hold the app up — the whole point
  // is that the cache has already painted and this only decides whether to
  // re-read. If it hasn't answered by the time an ordinary read would have,
  // abandon it and let callers read through, as they did before any of this.
  const result = Promise.race([
    probe,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), REVISION_TIMEOUT_MS)),
  ])
  revisionProbe = { id: instance.id, at: now, result }
  return result
}

/** Invalidate the shared probe after our own writes: the vault has certainly
 *  moved, and the remembered answer is now the *previous* revision — which
 *  would mark stale caches as current. */
function forgetRevision(): void {
  revisionProbe = undefined
}

// Cached records belong to a vault *binding*, not just an instance: pointing
// the same instance at a different repo keeps its id while replacing every file
// behind it. Rather than relying on every reconfigure path to remember to clear
// the cache, the binding is recorded alongside it and checked before the first
// cached read of a session — a mismatch drops the lot.
const scopeKey = (instanceId: string) => `scope|${instanceId}`
const verifiedScope = new Map<string, string>()

async function ensureCacheScope(instance: VaultInstance): Promise<void> {
  const ctx = vaultCtxFor(instance.id)
  const scope = instance.provider.label?.(ctx) ?? instance.provider.id
  if (verifiedScope.get(instance.id) === scope) return
  const stored = await cacheGet<{ scope: string }>(scopeKey(instance.id))
  if (stored?.scope !== scope) {
    cacheDeletePrefix(instancePrefix(instance.id))
    cacheSet(scopeKey(instance.id), { scope })
  }
  verifiedScope.set(instance.id, scope)
}

/** Forget everything cached for an instance — on disconnect, so a vault the
 *  user removed leaves nothing of its contents behind in the browser. */
function dropVaultCache(instanceId: string): void {
  cacheDeletePrefix(instancePrefix(instanceId))
  cacheDelete(scopeKey(instanceId))
  verifiedScope.delete(instanceId)
}

/** A remote change invalidates only the files it touched. Blob shas are
 *  content-derived, so comparing the old listing with the new one says exactly
 *  which cached files (and image bytes) are no longer what the vault holds. */
function reconcileCache(instanceId: string, before: VaultEntry[] | undefined, after: VaultEntry[]): void {
  if (!before) return
  const now = new Map(after.filter((e) => e.type === 'file').map((e) => [e.path, e.sha]))
  for (const entry of before) {
    if (entry.type !== 'file') continue
    // Same sha means the same bytes; anything else (changed, or gone) means
    // whatever was cached for that path can't be reused.
    if (now.has(entry.path) && now.get(entry.path) === entry.sha) continue
    cacheDelete(fileKey(instanceId, entry.path))
    cacheDelete(blobKey(instanceId, entry.path))
  }
}

/** Apply a local structural change (create, delete, rename) to the cached
 *  listing, so the next launch paints the tree as the user left it. The
 *  revision is dropped with the edit: the listing now matches no revision we
 *  could name, so it'll be re-listed before it's trusted again. */
async function patchCachedTree(
  instanceId: string,
  patch: (entries: VaultEntry[]) => VaultEntry[],
): Promise<void> {
  const cached = await cacheGet<CachedTree>(treeKey(instanceId))
  if (!cached) return
  cacheSet(treeKey(instanceId), { entries: patch(cached.entries) })
}

/** Record a file added to the active vault from outside this module — images
 *  are committed by lib/vaultImages, which the tree would otherwise never hear
 *  about (the same reason the sidebar listens for uploads). */
export function recordVaultFileAdded(path: string): void {
  const active = activeVaultInstance()
  if (!active) return
  forgetRevision()
  void patchCachedTree(active.id, (entries) =>
    entries.some((e) => e.path === path) ? entries : [...entries, { path, type: 'file' }],
  )
}

/**
 * The vault's file listing. Answers from cache first — `onCached` fires
 * synchronously-soon with the last known listing so the sidebar can paint
 * without waiting — then confirms with the provider and resolves to the
 * current listing, which is the cached one verbatim when nothing has changed.
 */
export async function loadVaultTree(
  onCached?: (entries: VaultEntry[]) => void,
): Promise<VaultEntry[]> {
  const active = activeVaultInstance()
  if (!active) throw new Error('No vault connected')
  await ensureCacheScope(active)
  const cached = await cacheGet<CachedTree>(treeKey(active.id))
  if (cached?.entries.length) onCached?.(cached.entries)

  // Sampled before the listing, never after: a commit landing in between would
  // otherwise stamp a fresh-looking revision on a listing taken before it.
  const revision = vaultRevision(active)
  if (cached?.revision) {
    const now = await revision
    if (now && now === cached.revision) return cached.entries
  }
  // Nothing usable cached — the probe and the listing are independent, so pay
  // for them at the same time rather than one after the other.
  const [entries, now] = await Promise.all([active.provider.listTree(vaultCtxFor(active.id)), revision])
  reconcileCache(active.id, cached?.entries, entries)
  cacheSet(treeKey(active.id), { revision: now, entries })
  return entries
}

// The currently open vault file, tracked here (not in React state) so
// `saveVaultFile` always has the right `sha` and can skip no-op writes.
let openPath: string | undefined
let openSha: string | undefined
let lastSavedContent: string | undefined
// The editor normalizes Markdown when it loads a document and emits one
// `markdownUpdated` for that round-trip — not a user edit. This makes the
// next `stageVaultEdit` adopt that emission as the clean baseline, so opening
// a file doesn't show "Unsaved changes" (and a later autosave doesn't commit
// a pure-reformatting diff).
let awaitingBaseline = false

export function currentVaultFile(): string | undefined {
  return openPath
}

/** What the open file's saved content currently *is*, per this module — which
 *  a background revalidation may have advanced since `openVaultFile` handed
 *  back the cached copy. Callers that do work between the two (warming images,
 *  say) should show this rather than what they were given, or a fresher version
 *  that landed meanwhile would be painted over by a stale one. */
export function currentVaultBaseline(path: string): string | undefined {
  return openPath === path ? lastSavedContent : undefined
}

export function clearOpenFile(): void {
  openPath = undefined
  openSha = undefined
  lastSavedContent = undefined
  awaitingBaseline = false
  clearPendingEdit()
  clearVaultOpenFile()
}

function markOpen(path: string, content: string, sha: string): void {
  openPath = path
  openSha = sha
  lastSavedContent = content
  awaitingBaseline = true
  setVaultOpenFile(path)
}

// A file swapped in behind the editor — the cached copy that was opened turned
// out to be behind the vault. The editor has to remount around new content, so
// this can't just be returned from openVaultFile; App subscribes and reloads.
const revalidateListeners = new Set<(file: { path: string; content: string }) => void>()

/** Subscribe to an open file being replaced by a newer remote version. */
export function onVaultFileRevalidated(
  cb: (file: { path: string; content: string }) => void,
): () => void {
  revalidateListeners.add(cb)
  return () => revalidateListeners.delete(cb)
}

/** Confirms a file opened from cache against the vault, in the background —
 *  the seam where "opened instantly" becomes "opened instantly *and* current".
 *  Deliberately unlocked: it only ever reads, and the one thing it mutates
 *  (the open file's baseline) it declines to touch the moment there's an edit
 *  in flight, so a save racing it keeps the sha it started with. */
async function revalidateOpenFile(instance: VaultInstance, path: string, cached: CachedFile): Promise<void> {
  try {
    const revision = await vaultRevision(instance)
    // The vault hasn't moved since this content was read — nothing can have
    // happened to it.
    if (revision && revision === cached.revision) return
    const file = await instance.provider.readFile(vaultCtxFor(instance.id), path)
    cacheSet(fileKey(instance.id, path), { content: file.content, sha: file.sha, revision })
    // Somewhere else by now — another file, another vault, or back to the draft.
    if (openPath !== path || activeVaultInstance()?.id !== instance.id) return
    if (file.sha === openSha) return
    // The user is mid-edit. Replacing what they're typing into isn't an option,
    // and neither is quietly adopting the new revision — that would turn a
    // genuine conflict into a silent overwrite of whatever landed remotely. Let
    // the save carry the sha it opened with and conflict honestly.
    if (pendingContent !== undefined || saveState === 'dirty' || saveState === 'saving') return
    markOpen(path, file.content, file.sha)
    revalidateListeners.forEach((cb) => cb({ path, content: file.content }))
  } catch {
    /* the cached copy stands; a failed check isn't worth surfacing */
  }
}

export async function openVaultFile(path: string): Promise<string> {
  return withWriteLock(async () => {
    await flushInternal().catch(() => {})
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    await ensureCacheScope(active)
    const cached = await cacheGet<CachedFile>(fileKey(active.id, path))
    if (cached) {
      markOpen(path, cached.content, cached.sha)
      // Not awaited — the whole point is that the editor gets its content now
      // and the network catches up afterwards.
      void revalidateOpenFile(active, path, cached)
      return cached.content
    }
    // Sample the revision alongside the read (not after it, which could stamp
    // the content with a revision newer than what was read).
    const revision = vaultRevision(active)
    const file = await active.provider.readFile(vaultCtxFor(active.id), path)
    cacheSet(fileKey(active.id, path), { content: file.content, sha: file.sha, revision: await revision })
    markOpen(path, file.content, file.sha)
    return file.content
  })
}

/** Programmatically replacing the editor's content (e.g. "Load content")
 *  triggers the same normalized reload echo as opening a file — so mark the
 *  next emission as the baseline rather than a user edit. */
export function expectReloadEcho(): void {
  awaitingBaseline = true
}

// --- Staged edits: for providers that batch writes (see batchWrites above),
// edits aren't saved immediately — they're staged here and flushed on a
// checkpoint (switching files/vaults, losing focus, an idle timeout) so a
// long editing session doesn't produce a commit per keystroke pause.

export type VaultSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
let saveState: VaultSaveState = 'idle'
let saveError: string | undefined
const saveStateListeners = new Set<(state: VaultSaveState) => void>()

function setSaveState(state: VaultSaveState, error?: string) {
  saveState = state
  saveError = error
  saveStateListeners.forEach((cb) => cb(state))
}

export function getVaultSaveState(): VaultSaveState {
  return saveState
}

export function getVaultSaveError(): string | undefined {
  return saveError
}

/** Subscribes to save-state changes (for the UI's Saving…/Saved indicator).
 *  Returns an unsubscribe function. */
export function onVaultSaveStateChange(cb: (state: VaultSaveState) => void): () => void {
  saveStateListeners.add(cb)
  return () => saveStateListeners.delete(cb)
}

/** Resets the indicator to idle without touching any pending edit — for a
 *  freshly opened/created file that has nothing stale (e.g. a lingering
 *  error from the previous file) worth showing. */
export function resetVaultSaveState(): void {
  setSaveState('idle')
}

let pendingContent: string | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
}

function clearPendingEdit() {
  pendingContent = undefined
  clearIdleTimer()
  setSaveState('idle')
}

/** How long to wait after the last edit before auto-saving: per the
 *  provider's `batchWrites` contract (with the user's per-instance override,
 *  if the provider declares one), or a short fixed delay for providers that
 *  don't batch, just enough to coalesce keystrokes. */
function pendingSaveDelayMs(): number {
  const active = activeVaultInstance()
  const batch = active?.provider.batchWrites
  if (!active || !batch) return 800
  const raw = batch.delayConfigKey ? getConfig(vaultNs(active.id), batch.delayConfigKey) : undefined
  const seconds = raw ? parseInt(raw, 10) : NaN
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : batch.defaultDelaySeconds) * 1000
}

/** Stages an edit: doesn't save immediately, just marks the file dirty and
 *  (re)starts the auto-save timer. Call `flushPendingVaultSave` to save
 *  immediately (e.g. on a checkpoint). */
export function stageVaultEdit(content: string): void {
  // The editor's first emission after a (re)load is its normalized round-trip
  // of the loaded content, not a user edit — adopt it as the clean baseline
  // and stay idle.
  if (awaitingBaseline) {
    awaitingBaseline = false
    lastSavedContent = content
    clearPendingEdit()
    return
  }
  // Edited back to exactly the saved text — nothing to commit.
  if (content === lastSavedContent) {
    clearPendingEdit()
    return
  }
  pendingContent = content
  setSaveState('dirty')
  clearIdleTimer()
  idleTimer = setTimeout(() => void flushPendingVaultSave(), pendingSaveDelayMs())
}

// Every vault *write* — autosave, create, delete, rename/move — runs through
// this one promise chain, so no two ever touch the branch at the same time.
// Without it, an autosave commit landing in the middle of a move advances the
// branch head and the move's ref update fails as a non-fast-forward. Reads
// don't take the lock; the write operations that must see a clean slate (e.g.
// switching files) flush inside their own locked turn.
let writeChain: Promise<unknown> = Promise.resolve()
function noop() {}
/** Exported for lib/vaultImages, whose uploads are commits too and so have to
 *  queue behind the same chain as everything else here. */
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn, fn)
  // Keep the chain alive whether this turn resolved or rejected.
  writeChain = result.then(noop, noop)
  return result
}

/** The actual staged-edit save, without taking the write lock — for callers
 *  that already hold it (they flush the open file before switching/moving). */
async function flushInternal(): Promise<void> {
  clearIdleTimer()
  if (pendingContent === undefined) return
  const content = pendingContent
  pendingContent = undefined
  setSaveState('saving')
  try {
    await saveVaultFile(content)
    setSaveState('saved')
  } catch (err) {
    setSaveState('error', err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** Saves whatever edit is staged, if any — called on checkpoints (switching
 *  files/vaults, losing focus, disconnecting) and by the auto-save timer.
 *  Serialized against every other vault write. */
export async function flushPendingVaultSave(): Promise<void> {
  return withWriteLock(flushInternal)
}

/** Reopens the file remembered from a previous session, if any. */
export async function reopenLastVaultFile(): Promise<{ path: string; content: string } | undefined> {
  const path = getVaultOpenFile()
  if (!path || !isVaultConnected()) return undefined
  try {
    const content = await openVaultFile(path)
    return { path, content }
  } catch {
    clearOpenFile()
    return undefined
  }
}

export async function saveVaultFile(content: string): Promise<void> {
  const active = activeVaultInstance()
  if (!active || !openPath) return
  if (content === lastSavedContent) return
  const path = openPath
  try {
    const { sha } = await active.provider.writeFile(vaultCtxFor(active.id), path, content, openSha)
    openSha = sha
    lastSavedContent = content
    // Our own commit moved the vault, so the file is cached without a revision:
    // current content, but nothing that lets a later launch skip checking.
    forgetRevision()
    cacheSet(fileKey(active.id, path), { content, sha })
  } catch (err) {
    if (err instanceof VaultConflictError) {
      // The file changed remotely — reload it so the next save has a fresh
      // sha, at the cost of losing this particular edit.
      const file = await active.provider.readFile(vaultCtxFor(active.id), path)
      openSha = file.sha
      lastSavedContent = file.content
      cacheSet(fileKey(active.id, path), { content: file.content, sha: file.sha })
    }
    throw err
  }
}

/** Creates an empty file and marks it as the open file (no read-back needed —
 *  the caller already knows the content is `''`). */
export async function createVaultFile(path: string): Promise<void> {
  return withWriteLock(async () => {
    await flushInternal().catch(() => {})
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    const { sha } = await active.provider.writeFile(vaultCtxFor(active.id), path, '')
    markOpen(path, '', sha)
    cacheSet(fileKey(active.id, path), { content: '', sha })
    recordVaultFileAdded(path)
  })
}

export async function deleteVaultFile(path: string): Promise<void> {
  return withWriteLock(async () => {
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    await active.provider.deleteFile(vaultCtxFor(active.id), path)
    forgetRevision()
    cacheDelete(fileKey(active.id, path))
    cacheDelete(blobKey(active.id, path))
    void patchCachedTree(active.id, (entries) => entries.filter((e) => e.path !== path))
    if (openPath === path) clearOpenFile()
  })
}

/** Delete a folder and everything under it. */
export async function deleteVaultDir(path: string): Promise<void> {
  return withWriteLock(async () => {
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    const ctx = vaultCtxFor(active.id)
    const prefix = `${path}/`
    await active.provider.deleteDir(ctx, path)
    forgetRevision()
    cacheDeletePrefix(fileKey(active.id, prefix))
    cacheDeletePrefix(blobKey(active.id, prefix))
    void patchCachedTree(active.id, (entries) =>
      entries.filter((e) => e.path !== path && !e.path.startsWith(prefix)),
    )
    if (openPath && (openPath === path || openPath.startsWith(prefix))) clearOpenFile()
  })
}

/** Re-point the currently open file to a new path after a rename/move, keeping
 *  it open with a fresh revision so subsequent saves target the new path. The
 *  editor content is unchanged, so no reload/baseline juggling is needed. */
async function repointOpenFile(to: string): Promise<void> {
  const active = activeVaultInstance()
  if (!active) return
  const file = await active.provider.readFile(vaultCtxFor(active.id), to)
  openPath = to
  openSha = file.sha
  lastSavedContent = file.content
  cacheSet(fileKey(active.id, to), { content: file.content, sha: file.sha })
  setVaultOpenFile(to)
}

/** Re-point everything cached under `from` at `to`. A move keeps the bytes, so
 *  the cached content and image blobs move with the paths rather than being
 *  thrown away — the vault didn't change, only where things sit in it. */
async function moveCachedPaths(instanceId: string, from: string, to: string): Promise<void> {
  const prefix = `${from}/`
  const destFor = (path: string) => (path === from ? to : `${to}/${path.slice(prefix.length)}`)
  const moved = (path: string) => path === from || path.startsWith(prefix)
  const cached = await cacheGet<CachedTree>(treeKey(instanceId))
  for (const entry of cached?.entries ?? []) {
    if (entry.type !== 'file' || !moved(entry.path)) continue
    const dest = destFor(entry.path)
    const file = await cacheGet<CachedFile>(fileKey(instanceId, entry.path))
    if (file) cacheSet(fileKey(instanceId, dest), file)
    const blob = await cacheGet<unknown>(blobKey(instanceId, entry.path))
    if (blob) cacheSet(blobKey(instanceId, dest), blob)
    cacheDelete(fileKey(instanceId, entry.path))
    cacheDelete(blobKey(instanceId, entry.path))
  }
  if (cached) {
    cacheSet(treeKey(instanceId), {
      entries: cached.entries.map((e) => (moved(e.path) ? { ...e, path: destFor(e.path) } : e)),
    })
  }
}

/** Rename/move a single file. Prefers the provider's `moveFile`; otherwise
 *  read-writes-deletes (fine for the text files the tree shows). */
export async function renameVaultFile(from: string, to: string): Promise<void> {
  return withWriteLock(async () => {
    await flushInternal().catch(() => {})
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    const ctx = vaultCtxFor(active.id)
    await active.provider.moveFile(ctx, from, to)
    forgetRevision()
    await moveCachedPaths(active.id, from, to)
    if (openPath === from) await repointOpenFile(to)
  })
}

/** Rename/move a folder and everything under it. */
export async function renameVaultDir(from: string, to: string): Promise<void> {
  return withWriteLock(async () => {
    await flushInternal().catch(() => {})
    const active = activeVaultInstance()
    if (!active) throw new Error('No vault connected')
    const ctx = vaultCtxFor(active.id)
    const prefix = `${from}/`
    await active.provider.moveDir(ctx, from, to)
    forgetRevision()
    await moveCachedPaths(active.id, from, to)
    if (openPath && openPath.startsWith(prefix)) {
      await repointOpenFile(`${to}/${openPath.slice(prefix.length)}`)
    }
  })
}
