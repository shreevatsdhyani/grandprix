import { useEffect, useRef, useState } from 'react'

/**
 * Ask the pit wall.
 *
 * A grounded question-answering agent over this session's own data — it reads
 * the same timeline, transcripts and correlations the panels do, and names the
 * tools it called so an answer can be checked rather than trusted.
 *
 * Feature-flagged on the backend (GP_AGENT=1); a 404 retires the launcher
 * rather than leaving a button that always fails.
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

export function PitWallChat({ sessionId, driver }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  // The agent answers about one driver in one race; carrying replies across a
  // switch would attach the previous session's numbers to the new heading.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [sessionId, driver])

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
      <button
        onClick={() => setOpen(true)}
        className="group fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2.5 rounded-full border border-hairline pl-4 pr-5 shadow-lg backdrop-blur-xl transition hover:border-hairline-bright sm:bottom-7 sm:right-7"
        style={{ background: 'linear-gradient(150deg, #171b22 0%, #0b0d12 100%)' }}
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-full"
          style={{ background: 'var(--team)', color: 'var(--team-ink)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </span>
        <span className="display text-[12px] uppercase text-ink-primary">Ask the pit wall</span>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-x-3 bottom-3 top-20 z-50 flex flex-col overflow-hidden rounded-2xl border border-hairline shadow-2xl backdrop-blur-xl sm:inset-auto sm:bottom-7 sm:right-7 sm:top-auto sm:h-[620px] sm:w-[400px]"
      style={{ background: 'linear-gradient(160deg, rgba(20,24,31,0.97) 0%, rgba(9,11,15,0.98) 100%)' }}
      role="dialog"
      aria-label="Pit wall assistant"
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3.5">
        <div className="min-w-0">
          <p className="display text-[14px] uppercase text-ink-primary">Ask the pit wall</p>
          <p className="mt-1 truncate text-[11px] text-ink-muted">
            Answers grounded in this session’s own data · {driver}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="-mr-1 rounded-lg p-1.5 text-ink-muted transition hover:bg-white/5 hover:text-ink-primary"
          aria-label="Close the assistant"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <>
            <p className="card-title">Try one of these</p>
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-hairline bg-raised/60 px-3 py-2.5 text-left text-xs leading-snug text-ink-secondary transition hover:border-hairline-bright hover:text-ink-primary"
              >
                <span className="flex-1">{q}</span>
                <svg className="h-3.5 w-3.5 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className="max-w-[88%] rounded-xl border px-3.5 py-2.5"
              style={
                msg.role === 'user'
                  ? {
                      borderColor: 'color-mix(in srgb, var(--team) 45%, transparent)',
                      background: 'color-mix(in srgb, var(--team) 14%, transparent)',
                    }
                  : { borderColor: 'var(--edge)', background: 'var(--panel-2)' }
              }
            >
              <p className="eyebrow" style={msg.role === 'user' ? { color: 'var(--team)' } : undefined}>
                {msg.role === 'user' ? 'You' : 'Pit wall'}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-primary">
                {msg.content}
              </p>

              {/* Which data the answer came from, so it can be checked. */}
              {msg.tools_used && msg.tools_used.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {msg.tools_used.map((tool, j) => (
                    <span
                      key={j}
                      className="mono rounded-full bg-surface px-2 py-0.5 text-[9px] text-ink-muted"
                    >
                      {tool.replace(/^get_/, '').replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-raised px-3.5 py-2.5">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-cyan"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
            <span className="text-xs text-ink-muted">Reading the session…</span>
          </div>
        )}

        {error && (
          <p
            className="rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed"
            style={{
              borderColor: 'color-mix(in srgb, var(--status-critical) 40%, transparent)',
              background: 'color-mix(in srgb, var(--status-critical) 9%, transparent)',
              color: 'var(--status-critical)',
            }}
          >
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex gap-2 border-t border-hairline p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about stress, pace or radio…"
          disabled={loading}
          className="control min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="btn btn-primary w-11 px-0"
          aria-label="Send"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  )
}
