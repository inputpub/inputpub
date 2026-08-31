import type { VaultEntry } from '../vault'

// A durable, per-instance cache of what's already been read from a vault — the
// file tree, the text of files opened, and image bytes. Without it every launch
// re-downloads a repo that almost never changed between one launch and the
// next, and the editor can't paint until GitHub answers.
//
// IndexedDB rather than localStorage: image bytes are Blobs (localStorage is
// text-only) and a vault of notes plus screenshots outgrows its ~5MB in a
// hurry. Everything here degrades to a plain in-memory Map when IndexedDB is
// unavailable (private windows, storage disabled) — a cache miss is always a
// correct outcome, just a slower one.
//
// Freshness is *not* this module's business: it stores what it's given, keyed
// by whatever revision markers the caller chose (see lib/vault.ts, which pairs
// each record with the vault revision it was read at).

const DB_NAME = 'inputpub.vault'
const STORE = 'cache'

/** Bytes above this aren't cached — a note's screenshots are worth keeping on
 *  disk, a 200MB screen recording dropped in the vault is not. */
const MAX_BLOB_BYTES = 10 * 1024 * 1024

const memory = new Map<string, unknown>()

let dbPromise: Promise<IDBDatabase | undefined> | undefined

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | undefined>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      // A blocked or failed open isn't worth retrying per call — fall back to
      // memory for the rest of the session.
      req.onerror = () => resolve(undefined)
      req.onblocked = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
  return dbPromise
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore | undefined> {
  const db = await openDb()
  if (!db) return undefined
  try {
    return db.transaction(STORE, mode).objectStore(STORE)
  } catch {
    return undefined
  }
}

function request<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const s = await store('readonly')
  if (!s) return memory.get(key) as T | undefined
  return (await request(s.get(key))) as T | undefined
}

/** Fire-and-forget: a write that fails (quota, private mode) costs a slower
 *  next launch and nothing else, so no caller should have to wait on it or
 *  handle it. */
export function cacheSet(key: string, value: unknown): void {
  memory.set(key, value)
  void store('readwrite').then((s) => {
    try {
      s?.put(value, key)
    } catch {
      /* not cloneable / quota exceeded — the memory copy still stands */
    }
  })
}

export function cacheDelete(key: string): void {
  memory.delete(key)
  void store('readwrite').then((s) => s?.delete(key))
}

/** Drop every key starting with `prefix` — for forgetting a whole vault
 *  instance, or a folder that was deleted or moved. */
export function cacheDeletePrefix(prefix: string): void {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key)
  void store('readwrite').then((s) => {
    try {
      // '￿' sorts after any character IndexedDB will have appended.
      s?.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))
    } catch {
      /* ignore */
    }
  })
}

// Keys are `<instanceId>|<kind>|<path>` so one prefix delete forgets an
// instance, and a longer one forgets a folder within it.
export const instancePrefix = (instanceId: string) => `${instanceId}|`
export const treeKey = (instanceId: string) => `${instanceId}|tree`
export const fileKey = (instanceId: string, path: string) => `${instanceId}|file|${path}`
export const blobKey = (instanceId: string, path: string) => `${instanceId}|blob|${path}`

/** The vault's file listing as of `revision`. An undefined revision means the
 *  listing's freshness can't be asserted (a write happened since, or the
 *  provider has no revision marker) — it can still be painted, but has to be
 *  re-listed before it's trusted. */
export interface CachedTree {
  revision?: string
  entries: VaultEntry[]
}

export interface CachedFile {
  content: string
  /** The provider's revision marker for this file (a GitHub blob sha), so a
   *  save made straight from the cache still carries a valid one. */
  sha: string
  /** The vault revision this content was read at — if the vault is still at
   *  that revision, the content needs no re-read. */
  revision?: string
}

export async function cachedBlob(instanceId: string, path: string): Promise<Blob | undefined> {
  const hit = await cacheGet<{ blob: Blob }>(blobKey(instanceId, path))
  return hit?.blob
}

export function cacheBlob(instanceId: string, path: string, blob: Blob): void {
  if (blob.size > MAX_BLOB_BYTES) return
  cacheSet(blobKey(instanceId, path), { blob })
}
