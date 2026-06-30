import { useState } from 'react'
import { destinations, type Destination } from '../../destinations'
import type { ConfigField } from '../../destinations/types'
import { fieldLoc, readField } from '../../lib/fields'
import { setConfig } from '../../lib/storage'
import { Button, Modal, ModalActions, ModalNote, ModalTitle } from '../Modal'
import { Field } from '../Field'

const iconCls =
  'inline-flex w-[1.2rem] items-center justify-center text-[1.05rem] [&_svg]:block [&_svg]:size-[1em]'

/** Enable/disable destinations and configure the ones that need it. */
export function SettingsDialog({
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
    <Modal onClose={onClose}>
      <ModalTitle>Customize</ModalTitle>
      <ModalNote>
        Toggle each destination on or off; expand the ones with a chevron to configure them. Saved
        only in this browser (localStorage); never uploaded.
      </ModalNote>

      {/* The destination list scrolls; the title and Close/Save stay pinned.
          The negative margin lets the scrollbar reach the dialog edge while
          content keeps its padding. */}
      <div className="-mx-[1.2rem] min-h-0 flex-1 overflow-y-auto px-[1.2rem]">
        <div className="flex flex-col divide-y divide-line">
          {destinations.map((d) => {
            const hasConfig = fieldsByDest[d.id].length > 0
            return (
              <div key={d.id} className="py-[0.55rem]">
                <div className="flex items-center justify-between gap-[0.6rem] text-[0.9rem]">
                  {hasConfig ? (
                    <button
                      type="button"
                      className="group inline-flex min-w-0 flex-1 cursor-pointer items-center gap-[0.55rem] text-left text-inherit"
                      aria-expanded={!!open[d.id]}
                      onClick={() => toggleOpen(d.id)}
                    >
                      <span className={iconCls}>{d.icon}</span>
                      <span>{d.name}</span>
                      <svg
                        className="size-[0.85em] shrink-0 opacity-45 transition-transform duration-150 group-aria-expanded:rotate-180"
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
                    <span className="inline-flex min-w-0 flex-1 cursor-default items-center gap-[0.55rem] text-left">
                      <span className={iconCls}>{d.icon}</span>
                      <span>{d.name}</span>
                    </span>
                  )}
                  <input
                    type="checkbox"
                    className="size-[1.05rem] shrink-0 cursor-pointer accent-btn-bg"
                    checked={!!enabled[d.id]}
                    onChange={(e) => onToggle(d.id, e.target.checked)}
                  />
                </div>
                {hasConfig && open[d.id] && (
                  // Indent matches the toggle icon (1.2rem) + gap (0.55rem).
                  <div className="flex flex-col gap-[0.7rem] pb-[0.3rem] pl-[1.75rem] pt-[0.7rem]">
                    {fieldsByDest[d.id].map((f) => (
                      <Field
                        key={f.key}
                        field={f}
                        value={values[locKey(d, f)]}
                        onChange={(value) => setValues((v) => ({ ...v, [locKey(d, f)]: value }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <a
          className="text-[0.8rem] text-muted no-underline hover:text-text hover:underline"
          href="https://bodhi.wtf/token/0xD6347200EEdB3f64bBdd2C363894dd043a24a488"
          target="_blank"
          rel="noreferrer"
        >
          Suggest a new destination ↗
        </a>
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
      </ModalActions>
    </Modal>
  )
}
