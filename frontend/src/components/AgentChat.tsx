import { useState } from 'react'

/**
 * Ask the Pit Wall — conversational agent over race data.
 *
 * Feature-flagged on the backend (GP_AGENT=1). If the endpoint isn't
 * available, gracefully shows an error.
 */

interface Props {
  sessionId: string
  driver: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  tools_used?: string[]
}

export function AgentChat({ sessionId, driver }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const question = input.trim()
    setInput('')
    setError(null)

    // Add user message
    const userMsg: Message = { role: 'user', content: question }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, session_id: sessionId, driver }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status} ${res.statusText}`)
      }

      const data = await res.json()

      // Add assistant response
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.answer,
        tools_used: data.tools_used,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('404') || msg.includes('Not Found')) {
        setError('Agent layer not available — set GP_AGENT=1 in backend .env')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card flex flex-col p-4" aria-label="Ask the pit wall">
      <h2 className="card-title mb-3">Ask the Pit Wall</h2>

      <div className="mb-3 flex-1 space-y-3 overflow-y-auto" style={{ minHeight: '200px', maxHeight: '400px' }}>
        {messages.length === 0 && (
          <p className="text-sm text-ink-muted">
            Ask a question about {driver}'s race — stress levels, lap times, what they said, or
            correlation analysis.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              msg.role === 'user'
                ? 'rounded bg-brand/10 px-3 py-2 text-sm text-ink-primary'
                : 'rounded border border-hairline bg-raised px-3 py-2 text-sm text-ink-secondary'
            }
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              {msg.role === 'user' ? 'You' : 'Pit Wall'}
            </div>
            <p className="leading-relaxed">{msg.content}</p>
            {msg.tools_used && msg.tools_used.length > 0 && (
              <p className="mt-1.5 text-[10px] text-ink-muted">
                Tools: {msg.tools_used.join(', ')}
              </p>
            )}
          </div>
        ))}

        {loading && (
          <div className="rounded border border-hairline bg-raised px-3 py-2 text-sm text-ink-muted">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider">Pit Wall</div>
            <p>Analyzing data...</p>
          </div>
        )}

        {error && (
          <div className="rounded border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
            <p className="font-semibold">Error</p>
            <p className="text-xs">{error}</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          disabled={loading}
          className="flex-1 rounded border border-hairline bg-raised px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded border border-brand/60 bg-brand/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-primary transition hover:bg-brand/20 disabled:opacity-50"
        >
          Ask
        </button>
      </form>

      <div className="mt-2 text-[10px] text-ink-muted">
        Examples: "When did stress peak?" • "What did the driver say at lap 35?" • "Was stress
        correlated with pace?"
      </div>
    </section>
  )
}
