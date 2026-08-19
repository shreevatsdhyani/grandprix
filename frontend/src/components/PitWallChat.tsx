import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { tint } from '../lib/mood'

/**
 * Ask the pit wall.
 *
 * A grounded question-answering agent over this session's own data — it reads
 * the same timeline, transcripts and correlations the panels do, and names the
 * tools it called so an answer can be checked rather than trusted.
 *
 * Feature-flagged on the backend (GP_AGENT=1); a 404 retires the launcher
 * rather than leaving a button that always fails.
 *
 * Deliberately not a modal: no overlay, no focus trap, `Escape` closes. A reader
 * mid-question should still be able to look at the chart the question is about.
 */

interface Props {
  sessionId: string | null
  driver: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  tools_used?: string[]
}

const SUGGESTIONS = [
  'When did stress peak, and what was said?',
  'Did the voice move before the lap times?',
  'Which laps should the pit wall have acted on?',
  'How does this driver compare to their own baseline?',
]

/**
 * Renders the `**lap 54**` the model reaches for as emphasis, not asterisks.
 *
 * Every model on the endpoint bolds the figure it is asked for — it is how they
 * write — and a plain-text bubble printed the marks, which reads as the answer
 * having come back malformed. This is deliberately only bold: the answers are
 * two or three sentences, so a markdown dependency would be a lot of bytes to
 * render a single construct. Anything else the model emits passes through
 * unchanged, which is why the split keeps its delimiters in the odd positions
 * rather than trying to parse.
 */
function emphasise(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-t1">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

/** The assistant bubble's shape — shared by an answer and by the waiting dots,
 *  so the wait reads as coming from the same speaker. */
const ASSISTANT_BUBBLE = 'max-w-[92%] self-start border-l-2 border-team bg-s2 px-3 py-[10px]'
const ASSISTANT_RADIUS = { borderRadius: '8px 8px 8px 2px' }

export function PitWallChat({ sessionId, driver }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    // scrollIntoView would also move the document behind a fixed panel; driving
    // the list's own scrollTop leaves the page where the reader left it.
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading, error, open])

  // The agent answers about one driver in one race; carrying replies across a
  // switch would attach the previous session's numbers to the new heading.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [sessionId, driver])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    // Closing must not drop focus to the top of the document — a keyboard reader
    // lands back on the control they opened.
    if (wasOpen.current && !open) launcherRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    // A question is often two lines long and never twenty; the field grows to fit
    // and then scrolls, so the composer can't swallow the conversation.
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }, [input, open])

  async function send(question: string) {
    const q = question.trim()
    if (!q || loading || !sessionId) return

    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setLoading(true)

    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: sessionId, driver }),
      })

      if (!res.ok) {
        if (res.status === 404) {
          setAvailable(false)
          throw new Error('The agent is switched off on this backend.')
        }
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, tools_used: data.tools_used ?? [] },
      ])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!available || !sessionId) return null

  if (!open) {
    return (
      // The glow lives on the wrapper because `.notch-lg` is a clip-path, and a
      // clip-path cuts away the element's own box-shadow along with its corners.
      <div className="fixed bottom-[26px] right-[26px] z-40 shadow-[0_14px_34px_-14px_rgba(255,122,0,0.8)] transition-shadow duration-[160ms] hover:shadow-[0_16px_44px_-12px_var(--pap)]">
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Ask the pit wall about this session"
          className="notch-lg flex cursor-pointer items-center gap-[10px] py-3 pl-[14px] pr-[18px] text-ink transition-[filter] duration-[160ms] hover:brightness-[1.08]"
          style={{ background: 'linear-gradient(120deg, var(--pap), #DD6200)' }}
        >
          <span
            className="grid h-[26px] w-[26px] place-items-center rounded-full text-[12px]"
            style={{ background: tint('var(--ink)', 16) }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 14.5v-2.5a7 7 0 0 1 14 0v2.5" />
              <path d="M19 19.5v0a2.5 2.5 0 0 1-2.5 2.5H13" />
              <rect x="2.5" y="13.5" width="4.2" height="6.5" rx="1.5" fill="currentColor" stroke="none" />
              <rect x="17.3" y="13.5" width="4.2" height="6.5" rx="1.5" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="font-cond text-[12px] font-bold uppercase leading-none tracking-[0.2em]">
            Ask the pit wall
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className="panel anim-rise z-40 flex flex-col overflow-hidden"
      style={{
        /* `position` is set here rather than with Tailwind's `fixed`, because
           `.panel` is declared after `@tailwind utilities` and sets
           `position: relative` at the same specificity — so the utility lost,
           and with it `bottom`/`right` had nothing to resolve against. The
           panel opened 1739px down a 2033px page: from anywhere but the very
           bottom of the scroll, clicking the launcher looked like it did
           nothing at all. */
        position: 'fixed',
        bottom: 26,
        right: 26,
        width: 'min(420px, calc(100vw - 52px))',
        maxHeight: 'min(620px, calc(100vh - 80px))',
      }}
      role="dialog"
      aria-label="Ask the pit wall"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-[14px]">
        <div className="min-w-0">
          <p className="eyebrow-lg">Ask the pit wall</p>
          {/* Naming the grounding is the whole promise: this answers about one
              driver in one session, and nothing outside it. */}
          <p
            className="mt-[5px] truncate font-sans text-[11px] font-normal leading-[1.3] text-t3"
            title={`${driver} — session ${sessionId}`}
          >
            Grounded in {driver}, session {sessionId}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="grid h-6 w-6 flex-none place-items-center rounded-[4px] text-t2 transition-colors hover:bg-s3 hover:text-t1"
        >
          <span aria-hidden="true" className="text-[12px] leading-none">
            ✕
          </span>
        </button>
      </div>

      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-[14px]"
      >
        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <p
              key={i}
              className="max-w-[88%] self-end whitespace-pre-wrap bg-s3 px-3 py-[9px] font-sans text-[13px] font-normal leading-[1.5] text-t1"
              style={{ borderRadius: '8px 8px 2px 8px' }}
            >
              {msg.content}
            </p>
          ) : (
            <div key={i} className={ASSISTANT_BUBBLE} style={ASSISTANT_RADIUS}>
              <p className="whitespace-pre-wrap font-sans text-[13px] font-normal leading-[1.5] text-t1">
                {emphasise(msg.content)}
              </p>

              {/* Which data the answer came from. This is the difference between a
                  grounded answer and a plausible one, so it is never collapsed. */}
              {msg.tools_used && msg.tools_used.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-[5px]">
                  {msg.tools_used.map((tool, j) => (
                    <span
                      key={`${i}-${j}`}
                      className="mono rounded-[3px] border border-line bg-glass px-[7px] py-[3px] text-[9.5px] font-medium leading-none text-t3"
                    >
                      {tool.replace(/^get_/, '').replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {loading && (
          <div
            className={`flex items-center gap-[5px] ${ASSISTANT_BUBBLE}`}
            style={ASSISTANT_RADIUS}
            role="status"
            aria-label="Reading the session"
          >
            {[0, 180, 360].map((d) => (
              <span
                key={d}
                className="anim-pulse block h-1 w-1 bg-pap"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        )}

        {/* An error stays in the transcript rather than closing the panel: the
            question is still on screen, so it can be asked again. */}
        {error && (
          <p role="alert" className="font-sans text-[12px] font-normal leading-[1.45] text-mag">
            The pit wall did not answer. {error}
          </p>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-col gap-[6px] px-4 pb-3">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="w-full rounded-[5px] border border-line bg-s2 px-[11px] py-2 text-left font-sans text-[12px] font-normal leading-[1.35] text-t2 transition-colors hover:border-pap hover:text-t1"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex items-end gap-2 border-t border-line px-4 pb-[14px] pt-3"
      >
        <textarea
          ref={fieldRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, because every message here is a question. Shift+Enter
            // is the escape hatch for the reader who wants to paste two of them.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder="Ask about stress, pace or radio…"
          aria-label="Your question"
          className="control min-w-0 flex-1"
          style={{
            minHeight: 36,
            maxHeight: 110,
            padding: '9px 11px',
            resize: 'none',
            lineHeight: 1.4,
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send question"
          className="notch-sm grid h-9 w-9 flex-none place-items-center bg-pap text-ink disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            ➤
          </span>
        </button>
      </form>
    </div>
  )
}
