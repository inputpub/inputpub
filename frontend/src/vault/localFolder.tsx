import type { VaultProvider } from './types'
import { TEXT_EXT } from './types'
import { FolderIcon } from '../destinations/icons'
import { clearHandle, loadHandle, saveHandle } from '../lib/fsHandleStore'

// Browses and edits files in a folder on disk via the File System Access API
// (Chromium browsers only — no Safari/Firefox support). Unlike the GitHub
// provider there are no config fields to fill in; "connecting" means opening
// the native picker and remembering the chosen folder for next time.

const HANDLE_KEY = 'local-folder'

function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? { dir: '', name: path } : { dir: path.slice(0, idx), name: path.slice(idx + 1) }
}

async function getDirForPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  if (!path) return dir
  for (const part of path.split('/')) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

/** Loads the remembered folder handle and confirms read/write permission.
 *  Regaining permission after a reload needs a user gesture (a click), so
 *  this only succeeds silently if the browser still considers it granted. */
async function getRootHandle(): Promise<FileSystemDirectoryHandle> {
  const handle = await loadHandle(HANDLE_KEY)
  if (!handle) throw new Error('No folder connected')
  const opts = { mode: 'readwrite' as const }
  if ((await handle.queryPermission(opts)) === 'granted') return handle
  if ((await handle.requestPermission(opts)) === 'granted') return handle
  throw new Error('Permission to the folder was denied — reconnect it from the vault settings')
}

export const localFolderVault: VaultProvider = {
  id: 'local-folder',
  name: 'Local Folder',
  icon: FolderIcon,
  blurb: 'Store your files in a folder on this computer — no account needed. Chrome/Edge only.',
  config: [],

  async connect(ctx) {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Local folders need a Chromium browser (Chrome, Edge, Arc, …)')
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await saveHandle(HANDLE_KEY, handle)
    ctx.setConfig('name', handle.name)
  },

  isConfigured(ctx) {
    return !!ctx.getConfig('name')?.trim()
  },

  async disconnect() {
    await clearHandle(HANDLE_KEY)
  },

  describe(ctx) {
    const name = ctx.getConfig('name')?.trim()
    return name ? `Connected to "${name}"` : undefined
  },

  label(ctx) {
    return ctx.getConfig('name')?.trim() || undefined
  },

  async listTree() {
    const root = await getRootHandle()
    const entries: Awaited<ReturnType<VaultProvider['listTree']>> = []
    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, handle] of dir.entries()) {
        const path = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') {
          entries.push({ path, type: 'dir' })
          await walk(handle, path)
        } else if (TEXT_EXT.test(name)) {
          entries.push({ path, type: 'file' })
        }
      }
    }
    await walk(root, '')
    return entries
  },

  async readFile(_ctx, path) {
    const root = await getRootHandle()
    const { dir, name } = splitPath(path)
    const dirHandle = await getDirForPath(root, dir, false)
    const file = await (await dirHandle.getFileHandle(name)).getFile()
    return { content: await file.text(), sha: String(file.lastModified) }
  },

  async writeFile(_ctx, path, content) {
    const root = await getRootHandle()
    const { dir, name } = splitPath(path)
    const dirHandle = await getDirForPath(root, dir, true)
    const fileHandle = await dirHandle.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
    const file = await fileHandle.getFile()
    return { sha: String(file.lastModified) }
  },

  async deleteFile(_ctx, path) {
    const root = await getRootHandle()
    const { dir, name } = splitPath(path)
    const dirHandle = await getDirForPath(root, dir, false)
    await dirHandle.removeEntry(name)
  },
}
