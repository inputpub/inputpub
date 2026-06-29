import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { destinations, type Destination } from './destinations'
import { GearIcon, MoreIcon, LoadIcon, ImageIcon, CoinIcon } from './destinations/icons'
import { renderTemplate, templateVars } from './lib/template'
import { fieldLoc, findField, readField } from './lib/fields'
import { useDismiss } from './lib/useDismiss'
import {
  debounce,
  getConfig,
  getEnabled,
  loadDraft,
  saveDraft,
  setConfig,
  setEnabled,
} from './lib/storage'
import { Menu, MenuDivider, MenuItem } from './components/Menu'
import { Toast, type ToastStatus } from './components/Toast'
import { LoadDialog } from './components/dialogs/LoadDialog'
import { ConfigDialog } from './components/dialogs/ConfigDialog'
import { PromptDialog } from './components/dialogs/PromptDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { ImageHostDialog } from './components/dialogs/ImageHostDialog'
import { ImageUploadDialog } from './components/dialogs/ImageUploadDialog'

/** Delay before a clipboard destination navigates away, so the user can read
 *  the "copied" toast first. */
const CLIPBOARD_OPEN_DELAY = 2000

function App() {
  const editorRef = useRef<EditorHandle>(null)
  const persist = useMemo(() => debounce(saveDraft, 400), [])
  // The editor seeds its content from this once per mount; bump editorKey to
  // remount it with fresh content (used by "Load content").
  const [seed, setSeed] = useState<string>(() => loadDraft())
  const [editorKey, setEditorKey] = useState(0)

  const [status, setStatus] = useState<ToastStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [imageHostOpen, setImageHostOpen] = useState(false)
  const [imageChoiceOpen, setImageChoiceOpen] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configFor, setConfigFor] = useState<Destination | null>(null)
  const [promptFor, setPromptFor] = useState<Destination | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    for (const d of destinations) m[d.id] = getEnabled(d.id) ?? d.defaultEnabled ?? true
    return m
  })
  const publishRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeTools = useCallback(() => setToolsOpen(false), [])
  useDismiss(publishRef, closeMenu, menuOpen)
  useDismiss(toolsRef, closeTools, toolsOpen)

  // Replace the editor's content (remount with a fresh seed) and persist it.
  function loadContent(text: string) {
    setSeed(text)
    setEditorKey((k) => k + 1)
    saveDraft(text)
  }

  function toggleEnabled(id: string, on: boolean) {
    setEnabled(id, on)
    setEnabledMap((m) => ({ ...m, [id]: on }))
  }

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 3500)
    return () => clearTimeout(t)
  }, [status])

  const ctxFor = (dest: Destination, input: Record<string, string>, markdown: string) => {
    const get = (key: string) => {
      const f = findField(dest, key)
      const [d, k] = f ? fieldLoc(dest, f) : [dest.id, key]
      return getConfig(d, k)
    }
    return {
      getConfig: get,
      setConfig: (key: string, value: string) => {
        const f = findField(dest, key)
        const [d, k] = f ? fieldLoc(dest, f) : [dest.id, key]
        setConfig(d, k, value)
      },
      input,
      slot: (key: string) => {
        const f = findField(dest, key)
        const stored = (get(key) ?? '').trim()
        const template = stored || f?.default || '{{ body }}'
        return renderTemplate(template, templateVars(markdown, input))
      },
    }
  }

  const isConfigured = (dest: Destination) =>
    !dest.config || dest.config.every((f) => f.optional || !!readField(dest, f))

  async function run(dest: Destination, input: Record<string, string> = {}) {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (!markdown.trim()) {
      setStatus({ kind: 'error', text: 'Nothing to publish' })
      return
    }
    setBusy(dest.id)
    setStatus(null)
    try {
      // Copy-and-paste destinations: copy, show a prominent toast, then
      // navigate (same tab) after a beat so the user reads it before leaving.
      if (dest.clipboard) {
        const text = ctxFor(dest, input, markdown).slot('content')
        let copied = false
        try {
          await navigator.clipboard.writeText(text)
          copied = true
        } catch {
          // clipboard may be unavailable; still send the user over
        }
        setStatus({
          kind: 'ok',
          big: true,
          text: copied
            ? `Copied to clipboard. Opening ${dest.name} — paste it there.`
            : `Opening ${dest.name} — copy your text and paste it there.`,
        })
        const { url } = dest.clipboard
        setTimeout(() => {
          window.location.href = url
        }, CLIPBOARD_OPEN_DELAY)
        return
      }
      const msg = await dest.send?.(markdown, ctxFor(dest, input, markdown))
      setStatus({ kind: 'ok', text: msg || `Sent to ${dest.name}` })
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  // After config is satisfied, either collect publish-time input or run directly.
  function proceed(dest: Destination) {
    if (dest.prompt?.length) setPromptFor(dest)
    else void run(dest)
  }

  function pick(dest: Destination) {
    setMenuOpen(false)
    if (!isConfigured(dest)) setConfigFor(dest)
    else proceed(dest)
  }

  return (
    // --sheet-max / --page-pad are the single source of truth for the sheet
    // width + horizontal gutter; both the sheet and the fixed top bar derive
    // their edges from these, so Publish always lines up with the sheet's right
    // edge at any width.
    <div className="relative min-h-dvh [--page-pad:1rem] [--sheet-max:820px] max-[700px]:[--page-pad:0.75rem]">
      {/* Top bar: scrolls with the page (absolute, not fixed) so Publish never
          covers the text once you scroll down. Its inner edges align with the
          centered sheet (same max-width + horizontal padding as the sheet area).
          Empty area lets clicks pass through; the two groups re-enable pointer
          events. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-40 mx-auto flex max-w-[calc(var(--sheet-max)+2*var(--page-pad))] items-start justify-between px-[var(--page-pad)]">
        <div className="pointer-events-auto relative" ref={toolsRef}>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent px-2 py-[0.3rem] text-muted opacity-60 transition duration-150 hover:bg-hover hover:text-text hover:opacity-100"
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
            aria-label="More"
            onClick={() => setToolsOpen((o) => !o)}
          >
            <span className="inline-flex text-[1.15rem] leading-none [&_svg]:block [&_svg]:size-[1em]">
              {MoreIcon}
            </span>
          </button>
          {toolsOpen && (
            <Menu align="left">
              <MenuItem
                icon={LoadIcon}
                onClick={() => {
                  setToolsOpen(false)
                  setLoadOpen(true)
                }}
              >
                Load content
              </MenuItem>
              <MenuItem
                icon={ImageIcon}
                onClick={() => {
                  setToolsOpen(false)
                  setImageHostOpen(true)
                }}
              >
                Configure image host
              </MenuItem>
              <MenuDivider />
              <MenuItem
                icon={CoinIcon}
                href="https://bodhi.wtf/token/0xD6347200EEdB3f64bBdd2C363894dd043a24a488"
                onClick={() => setToolsOpen(false)}
              >
                $INPUT
              </MenuItem>
            </Menu>
          )}
        </div>

        <div className="pointer-events-auto relative" ref={publishRef}>
          <button
            type="button"
            className="group inline-flex cursor-pointer items-center gap-[0.3rem] rounded-md border border-transparent py-[0.3rem] pl-[0.6rem] pr-[0.4rem] font-medium text-muted opacity-70 transition duration-150 enabled:hover:bg-hover enabled:hover:text-text enabled:hover:opacity-100 enabled:active:translate-y-px disabled:cursor-default disabled:opacity-45"
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span>{busy ? 'Publishing…' : 'Publish'}</span>
            <svg
              className="shrink-0 opacity-70 transition-transform duration-150 group-aria-expanded:rotate-180"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {menuOpen && (
            <Menu>
              {destinations
                .filter((dest) => enabledMap[dest.id])
                .map((dest) => (
                  <MenuItem key={dest.id} icon={dest.icon} title={dest.hint} onClick={() => pick(dest)}>
                    {dest.name}
                  </MenuItem>
                ))}
              <MenuDivider />
              <MenuItem
                icon={GearIcon}
                onClick={() => {
                  setMenuOpen(false)
                  setSettingsOpen(true)
                }}
              >
                Customize
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>

      {/* A4-ish sheet: runs flush to the bottom of the window (no bottom gap,
          squared bottom corners), then grows with content. */}
      <main className="flex min-h-dvh justify-center bg-backdrop px-[var(--page-pad)] pt-16">
        <div className="flex h-max min-h-[calc(100dvh-4rem)] w-full max-w-[var(--sheet-max)] rounded-t-lg border border-line bg-paper px-[92px] py-12 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] max-[700px]:px-5 max-[700px]:pb-8 max-[700px]:pt-7">
          <Editor
            key={editorKey}
            ref={editorRef}
            defaultValue={seed}
            onChange={persist}
            onImageUploadUnconfigured={() => setImageChoiceOpen(true)}
            onImageUploadError={(text) => setStatus({ kind: 'error', text })}
          />
        </div>
      </main>

      {status && <Toast status={status} />}

      {configFor && (
        <ConfigDialog
          dest={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={(dest) => {
            setConfigFor(null)
            proceed(dest)
          }}
        />
      )}

      {promptFor && (
        <PromptDialog
          dest={promptFor}
          onCancel={() => setPromptFor(null)}
          onSubmit={(dest, values) => {
            setPromptFor(null)
            void run(dest, values)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          enabled={enabledMap}
          onToggle={toggleEnabled}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {loadOpen && (
        <LoadDialog
          hasContent={() => !!editorRef.current?.getMarkdown()?.trim()}
          onLoaded={loadContent}
          onClose={() => setLoadOpen(false)}
        />
      )}

      {imageChoiceOpen && (
        <ImageUploadDialog
          onClose={() => setImageChoiceOpen(false)}
          onConfigure={() => {
            setImageChoiceOpen(false)
            setImageHostOpen(true)
          }}
          onUpgrade={() => {
            window.location.href = '/pro'
          }}
        />
      )}

      {imageHostOpen && <ImageHostDialog onClose={() => setImageHostOpen(false)} />}
    </div>
  )
}

export default App
