import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/**
 * The pit wall's picker.
 *
 * This exists because a native `<select>` cannot be styled where it matters. The
 * closed box takes CSS, but the open list is drawn by the operating system — on
 * Windows that is a flat light-grey menu with square corners and a system font,
 * dropped on top of a dark carbon UI. `option { background }` does not reach it.
 * So the list is rebuilt here as a real listbox: glass fill, livery colour on the
 * row, and a number chip that survives being read at a glance.
 *
 * Focus stays on the trigger the whole time and the active row is announced via
 * `aria-activedescendant`, which is the pattern a native select uses too — that
 * way arrow keys, Home/End, Enter, Escape and type-ahead all behave the way
 * anyone who has used a `<select>` expects, with no focus juggling to get wrong.
 */

export interface SelectOption {
  value: string
  /** Plain text. Backs type-ahead, and is the label if none is given. */
  text: string
  /** Compact content for the closed trigger. */
  label?: React.ReactNode
  /** Richer content for the open list. Falls back to `label`. */
  row?: React.ReactNode
  /** Livery or accent colour, painted as a rail on the selected row. */
  accent?: string
}

interface Props {
  /** Shown above the control, and read as the first half of its name. */
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Layout classes for the wrapper — width and flex behaviour live here. */
  className?: string
  /** Width constraints for the popup, which is often wider than the trigger. */
  menuClassName?: string
  disabled?: boolean
}

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  className = '',
  menuClassName = '',
  disabled = false,
}: Props) {
  const uid = useId()
  const labelId = `${uid}-label`
  const valueId = `${uid}-value`
  const listId = `${uid}-list`
  const optionId = (i: number) => `${uid}-opt-${i}`

  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** Horizontal nudge that keeps a wide list inside a narrow viewport. */
  const [shift, setShift] = useState(0)

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const selected = options[selectedIndex]

  // Type-ahead buffer. Held in a ref because it is transient input state, not
  // something the render depends on.
  const typed = useRef({ buf: '', at: 0 })

  function openMenu(startAt = selectedIndex) {
    if (disabled || options.length === 0) return
    setActive(startAt)
    setOpen(true)
  }

  function commit(i: number) {
    const opt = options[i]
    setOpen(false)
    if (opt && opt.value !== value) onChange(opt.value)
  }

  // Dismiss on a click anywhere else. `pointerdown` rather than `click` so the
  // menu is gone before whatever was clicked reacts.
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // The list is wider than its trigger, and on a phone the trigger sits close
  // enough to the right edge that a left-aligned list runs off it. `body` has
  // `overflow-x: hidden`, so that would silently cut the rows off rather than
  // producing a scrollbar. Measure once on open and slide it back inside.
  // Adjusts `left` rather than `transform`: the entry animation owns transform,
  // and its `both` fill mode would keep overwriting the offset.
  useLayoutEffect(() => {
    if (!open) return setShift(0)
    const r = listRef.current?.getBoundingClientRect()
    if (!r) return
    const margin = 8
    let dx = 0
    if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right
    if (r.left + dx < margin) dx = margin - r.left
    setShift(dx)
  }, [open])

  // Keep the active row in view when arrowing past either end of the scroll box.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        return
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Home':
        e.preventDefault()
        setActive(0)
        return
      case 'End':
        e.preventDefault()
        setActive(last)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        return
      case 'Tab':
        // Let focus move on, but do not leave a menu open behind it.
        setOpen(false)
        return
    }

    // Type-ahead: "ham" jumps to Hamilton. Buffer resets after a pause so the
    // next burst starts a new word rather than extending a stale one.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      typed.current.buf = now - typed.current.at > 800 ? e.key : typed.current.buf + e.key
      typed.current.at = now
      const needle = typed.current.buf.toLowerCase()
      const hit = options.findIndex((o) => o.text.toLowerCase().startsWith(needle))
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <div ref={rootRef} className={`relative flex min-w-0 flex-col gap-1 ${className}`}>
      <span id={labelId} className="field-label">
        {label}
      </span>

      <button
        type="button"
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? optionId(active) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="control-glass w-full"
      >
        <span id={valueId} className="min-w-0 flex-1 truncate text-left">
          {selected?.label ?? selected?.text ?? '—'}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          tabIndex={-1}
          style={{ left: shift }}
          className={`menu-pop absolute top-[calc(100%+7px)] z-50 max-h-[min(58vh,340px)] w-max min-w-full overflow-y-auto overscroll-contain p-1.5 ${menuClassName}`}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value
            return (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                data-active={i === active || undefined}
                onClick={() => commit(i)}
                onPointerMove={() => setActive(i)}
                className="menu-row"
                style={o.accent ? ({ ['--row-accent' as string]: o.accent } as React.CSSProperties) : undefined}
              >
                <span className="min-w-0 flex-1">{o.row ?? o.label ?? o.text}</span>
                {isSelected && <Tick />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** A drawn chevron, not two clipped gradients — it has to survive a projector. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-ink-secondary transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : undefined }}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  )
}

function Tick() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="ml-2 shrink-0 text-accent-cyan"
    >
      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
    </svg>
  )
}
