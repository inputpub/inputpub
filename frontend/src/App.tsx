import { useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { destinations, type Destination } from './destinations'
import type { ConfigField } from './destinations/types'
import { GearIcon } from './destinations/icons'
import { renderTemplate, templateVars } from './lib/template'
import {
  debounce,
  getConfig,
  getEnabled,
  loadDraft,
  saveDraft,
  setConfig,
  setEnabled,
} from './lib/storage'
import './App.css'

type Status = { kind: 'ok' | 'error'; text: string; big?: boolean } | null

/** Delay before a clipboard destination navigates away, so the user can read
 *  the "copied" toast first. */
const CLIPBOARD_OPEN_DELAY = 2000

/** Where a config field is stored: a shared global key, or the destination's
 *  own namespace. Lets GitHub + Gist share one token. */
function fieldLoc(dest: Destination, field: ConfigField): [string, string] {
  return field.shared ? ['shared', field.shared] : [dest.id, field.key]
}
function findField(dest: Destination, key: string): ConfigField | undefined {
  return (
    (dest.config ?? []).find((f) => f.key === key) ??
    (dest.prompt ?? []).find((f) => f.key === key)
  )
}
function readField(dest: Destination, field: ConfigField): string {
  const [d, k] = fieldLoc(dest, field)
  return getConfig(d, k) ?? ''
}

function App() {
  const editorRef = useRef<EditorHandle>(null)
  const initialDraft = useMemo(() => loadDraft(), [])
  const persist = useMemo(() => debounce(saveDraft, 400), [])

  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configFor, setConfigFor] = useState<Destination | null>(null)
  const [promptFor, setPromptFor] = useState<Destination | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    for (const d of destinations) m[d.id] = getEnabled(d.id) ?? d.defaultEnabled ?? true
    return m
  })
  const publishRef = useRef<HTMLDivElement>(null)

  function toggleEnabled(id: string, on: boolean) {
    setEnabled(id, on)
    setEnabledMap((m) => ({ ...m, [id]: on }))
  }

  // Close the publish menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!publishRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
    <div className="app">
      <div className="topbar">
        <div className="publish" ref={publishRef}>
          <button
            type="button"
            className="publish-btn"
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span>{busy ? 'Publishing…' : 'Publish'}</span>
            <svg
              className="publish-caret"
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
            <div className="publish-menu" role="menu">
              {destinations
                .filter((dest) => enabledMap[dest.id])
                .map((dest) => (
                <button
                  key={dest.id}
                  type="button"
                  role="menuitem"
                  className="publish-item"
                  title={dest.hint}
                  onClick={() => pick(dest)}
                >
                  <span className="publish-item-icon">{dest.icon}</span>
                  <span className="publish-item-name">{dest.name}</span>
                </button>
              ))}
              <div className="publish-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="publish-item"
                onClick={() => {
                  setMenuOpen(false)
                  setSettingsOpen(true)
                }}
              >
                <span className="publish-item-icon">{GearIcon}</span>
                <span className="publish-item-name">Settings</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <main className="sheet-area">
        <div className="sheet">
          <Editor
            ref={editorRef}
            defaultValue={initialDraft}
            onChange={persist}
            onImageUploadAttempt={() => {
              // Image upload is a Pro feature — send them to the Pro page.
              window.location.href = '/pro'
            }}
          />
        </div>
      </main>

      {status && (
        <div className={`toast ${status.kind}${status.big ? ' big' : ''}`} role="status">
          {status.text}
        </div>
      )}

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
    </div>
  )
}

function ConfigDialog({
  dest,
  onClose,
  onSaved,
}: {
  dest: Destination
  onClose: () => void
  onSaved: (dest: Destination) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((dest.config ?? []).map((f) => [f.key, readField(dest, f)])),
  )

  const canSave = (dest.config ?? []).every((f) => f.optional || values[f.key]?.trim())

  function save() {
    for (const f of dest.config ?? []) {
      const [d, k] = fieldLoc(dest, f)
      setConfig(d, k, values[f.key].trim())
    }
    onSaved(dest)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>
          {dest.icon} {dest.name} settings
        </h2>
        <p className="dialog-note">Saved only in this browser (localStorage); never uploaded.</p>
        {(dest.config ?? []).map((f) =>
          f.type === 'textarea' ? (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <textarea
                className="field-textarea"
                placeholder={f.placeholder ?? f.default}
                value={values[f.key]}
                rows={6}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              {f.hint && <span className="field-hint">{f.hint}</span>}
            </label>
          ) : (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input
                type={f.type ?? 'text'}
                placeholder={f.placeholder ?? f.default}
                value={values[f.key]}
                autoFocus
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) save()
                }}
              />
              {f.hint && <span className="field-hint">{f.hint}</span>}
            </label>
          ),
        )}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!canSave} onClick={save}>
            Save & publish
          </button>
        </div>
      </div>
    </div>
  )
}

function PromptDialog({
  dest,
  onCancel,
  onSubmit,
}: {
  dest: Destination
  onCancel: () => void
  onSubmit: (dest: Destination, values: Record<string, string>) => void
}) {
  const fields = dest.prompt ?? []
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )
  const canSubmit = fields.every((f) => f.optional || values[f.key]?.trim())

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>
          {dest.icon} Publish to {dest.name}
        </h2>
        {fields.map((f, i) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder}
              value={values[f.key]}
              autoFocus={i === 0}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) onSubmit(dest, values)
              }}
            />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!canSubmit} onClick={() => onSubmit(dest, values)}>
            Publish
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsDialog({
  enabled,
  onToggle,
  onClose,
}: {
  enabled: Record<string, boolean>
  onToggle: (id: string, on: boolean) => void
  onClose: () => void
}) {
  // Config fields shown per destination, deduping fields shared across
  // destinations (the GitHub token shows once, under GitHub — not Gist).
  const seen = new Set<string>()
  const fieldsByDest: Record<string, ConfigField[]> = {}
  for (const d of destinations) {
    fieldsByDest[d.id] = (d.config ?? []).filter((f) => {
      if (f.shared) {
        if (seen.has(f.shared)) return false
        seen.add(f.shared)
      }
      return true
    })
  }

  const locKey = (d: Destination, f: ConfigField) => fieldLoc(d, f).join('.')
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const d of destinations)
      for (const f of fieldsByDest[d.id]) v[locKey(d, f)] = readField(d, f)
    return v
  })
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggleOpen = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }))

  function save() {
    for (const d of destinations)
      for (const f of fieldsByDest[d.id]) {
        const [sd, sk] = fieldLoc(d, f)
        setConfig(sd, sk, (values[locKey(d, f)] ?? '').trim())
      }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="dialog-note">
          Toggle each destination on or off; expand the ones with a chevron to configure them. Saved
          only in this browser (localStorage); never uploaded.
        </p>

        <div className="settings-dests">
          {destinations.map((d) => {
            const hasConfig = fieldsByDest[d.id].length > 0
            return (
            <div key={d.id} className="settings-dest">
              <div className="dest-row">
                {hasConfig ? (
                  <button
                    type="button"
                    className="dest-head"
                    aria-expanded={!!open[d.id]}
                    onClick={() => toggleOpen(d.id)}
                  >
                    <span className="toggle-icon">{d.icon}</span>
                    <span className="dest-name">{d.name}</span>
                    <svg
                      className="dest-caret"
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
                ) : (
                  <span className="dest-head dest-head--static">
                    <span className="toggle-icon">{d.icon}</span>
                    <span className="dest-name">{d.name}</span>
                  </span>
                )}
                <input
                  type="checkbox"
                  checked={!!enabled[d.id]}
                  onChange={(e) => onToggle(d.id, e.target.checked)}
                />
              </div>
              {hasConfig && open[d.id] && (
                <div className="settings-dest-config">
                  {fieldsByDest[d.id].map((f) => (
                    <label key={f.key} className="field">
                      <span>{f.label}</span>
                      {f.type === 'textarea' ? (
                        <textarea
                          className="field-textarea"
                          placeholder={f.placeholder ?? f.default}
                          value={values[locKey(d, f)]}
                          rows={6}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [locKey(d, f)]: e.target.value }))
                          }
                        />
                      ) : (
                        <input
                          type={f.type ?? 'text'}
                          placeholder={f.placeholder ?? f.default}
                          value={values[locKey(d, f)]}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [locKey(d, f)]: e.target.value }))
                          }
                        />
                      )}
                      {f.hint && <span className="field-hint">{f.hint}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            )
          })}
        </div>

        <a
          className="settings-suggest"
          href="https://github.com/timqian/inputpub/issues/new?title=Suggest%20a%20new%20destination&labels=destination"
          target="_blank"
          rel="noreferrer"
        >
          Suggest a new destination ↗
        </a>

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={save}>
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
