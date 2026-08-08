import { useRef, useState } from 'react'
import { getAiPrompts, setAiPrompts, type AiPrompt } from '../../lib/storage'
import { Button, Modal, ModalActions, ModalNote, ModalTitle } from '../Modal'
import { SparklesIcon } from '../../destinations/icons'

const rowInputCls =
  'w-full rounded-control border border-line bg-bg px-2 py-1.5 text-[0.82rem] text-inherit focus:border-accent focus:outline-none'

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`

/** Manage the prompts shown as ✨ suggestions in the editor's "Ask AI" palette.
 *  Stored only in this browser. `onSaved` fires when the list actually changed,
 *  so the editor can remount to pick the new suggestions up (they're read once
 *  at mount). */
export function AiPromptsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved?: () => void
}) {
  const [prompts, setPrompts] = useState<AiPrompt[]>(getAiPrompts)
  const initial = useRef(JSON.stringify(prompts))
  const [saved, setSaved] = useState(false)

  const updatePrompt = (id: string, patch: Partial<AiPrompt>) =>
    setPrompts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const removePrompt = (id: string) => setPrompts((list) => list.filter((p) => p.id !== id))
  const addPrompt = () => setPrompts((list) => [...list, { id: newId(), label: '', prompt: '' }])

  function save() {
    // Drop half-filled rows; a usable prompt needs both a label and an instruction.
    const cleaned = prompts
      .map((p) => ({ id: p.id, label: p.label.trim(), prompt: p.prompt.trim() }))
      .filter((p) => p.label && p.prompt)
    setAiPrompts(cleaned)
    if (JSON.stringify(cleaned) !== initial.current) onSaved?.()
    setSaved(true)
    setTimeout(onClose, 700)
  }

  return (
    <Modal onClose={onClose}>
      <ModalTitle>
        <span className="[&_svg]:inline [&_svg]:size-[0.9em] [&_svg]:align-[-0.1em]">
          {SparklesIcon}
        </span>{' '}
        AI prompts
      </ModalTitle>
      <ModalNote>
        Shown as ✨ suggestions when you ask AI to revise a selection. The label is what you see;
        the prompt is the instruction sent to the model. Saved only in this browser.
      </ModalNote>

      <div className="-mx-[1.2rem] flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5">
        {prompts.map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <input
                className={rowInputCls}
                placeholder="Label (e.g. Make shorter)"
                value={p.label}
                onChange={(e) => updatePrompt(p.id, { label: e.target.value })}
              />
              <textarea
                className={`${rowInputCls} min-h-[2.4rem] resize-y leading-snug`}
                placeholder="Instruction sent to the AI…"
                rows={2}
                value={p.prompt}
                onChange={(e) => updatePrompt(p.id, { prompt: e.target.value })}
              />
            </div>
            <button
              type="button"
              aria-label="Remove prompt"
              className="mt-0.5 shrink-0 cursor-pointer rounded-item border-none bg-transparent px-2 py-1 text-[1.1rem] leading-none text-muted hover:bg-hover hover:text-text"
              onClick={() => removePrompt(p.id)}
            >
              ×
            </button>
          </div>
        ))}
        {prompts.length === 0 && (
          <p className="m-0 py-2 text-center text-[0.8rem] text-muted">
            No prompts yet. Add one below.
          </p>
        )}
      </div>

      <button
        type="button"
        className="cursor-pointer rounded-control border border-dashed border-line bg-transparent py-2 text-[0.82rem] text-muted hover:border-accent hover:text-text"
        onClick={addPrompt}
      >
        + Add prompt
      </button>

      <ModalActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
      </ModalActions>
    </Modal>
  )
}
