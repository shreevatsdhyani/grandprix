import { useEffect, useRef, useState } from 'react'

/**
 * Floating "Ask the Pit Wall" chatbot.
 *
 * Modern chat interface with:
 * - Floating trigger button (bottom-right)
 * - Suggested questions
 * - Auto-scroll to latest message
 * - Typing indicator
 * - Tool usage transparency
 *
 * Feature-flagged on backend (GP_AGENT=1). Gracefully hides if unavailable.
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

const SUGGESTED_QUESTIONS = [
  'When did stress peak?',
  'Was stress correlated with pace?',
  'Find the most stressed moments',
  'What did the driver say at the highest stress lap?',
  'Analyze the lead-lag relationship',
]

export function PitWallChat({ sessionId, driver }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading, isOpen])

  // Reset when session/driver changes
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [sessionId, driver])

  async function sendMessage(question: string) {
    if (!question.trim() || loading || !sessionId) return

    setInput('')
    setError(null)

    // Add user message
    const userMsg: Message = { role: 'user', content: question.trim() }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          session_id: sessionId,
          driver,
        }),
      })

      if (!res.ok) {
        if (res.status === 404) {
          // Agent endpoint not available
          setAvailable(false)
          throw new Error('Agent layer not enabled on backend')
        }
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status} ${res.statusText}`)
      }

      const data = await res.json()

      // Add assistant response
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.answer,
        tools_used: data.tools_used || [],
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleSuggestionClick(question: string) {
    sendMessage(question)
  }

  // Don't render if agent not available
  if (!available) return null

  // Don't render if no session selected
  if (!sessionId) return null

  return (
    <>
      {/* Floating trigger button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-brand/60 bg-brand/90 shadow-lg transition hover:scale-105 hover:bg-brand"
          aria-label="Open pit wall chat"
          title="Ask the Pit Wall"
        >
          <svg
            className="h-6 w-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          {/* Notification badge if this is first time seeing it */}
          {messages.length === 0 && (
            <span className="absolute right-0 top-0 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-good opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-status-good"></span>
            </span>
          )}
        </button>
      )}

      {/* Chat modal */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] flex-col overflow-hidden rounded-lg border border-hairline bg-surface shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline bg-raised px-4 py-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-ink-primary">
                Ask the Pit Wall
              </h3>
              <p className="text-[10px] text-ink-muted">
                {driver} • {sessionId}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 text-ink-muted transition hover:bg-surface hover:text-ink-primary"
              aria-label="Close chat"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !loading && (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  I can answer questions about {driver}'s stress levels, lap performance, radio
                  transcripts, and correlations.
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Try asking:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(q)}
                        className="rounded-full border border-brand/40 bg-brand/5 px-3 py-1.5 text-xs text-ink-secondary transition hover:border-brand/60 hover:bg-brand/10"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-brand/20 px-4 py-2.5'
                        : 'max-w-[85%] rounded-2xl rounded-bl-sm border border-hairline bg-raised px-4 py-2.5'
                    }
                  >
                    <p className="text-sm leading-relaxed text-ink-primary">{msg.content}</p>
                    {msg.tools_used && msg.tools_used.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {msg.tools_used.map((tool, j) => (
                          <span
                            key={j}
                            className="rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted"
                          >
                            {tool.replace('get_', '').replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-hairline bg-raised px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex space-x-1">
                        <div
                          className="h-2 w-2 animate-bounce rounded-full bg-ink-muted"
                          style={{ animationDelay: '0ms' }}
                        ></div>
                        <div
                          className="h-2 w-2 animate-bounce rounded-full bg-ink-muted"
                          style={{ animationDelay: '150ms' }}
                        ></div>
                        <div
                          className="h-2 w-2 animate-bounce rounded-full bg-ink-muted"
                          style={{ animationDelay: '300ms' }}
                        ></div>
                      </div>
                      <span className="text-xs text-ink-muted">Analyzing data...</span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  <strong>Error:</strong> {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-hairline bg-raised p-4">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={loading}
                className="flex-1 rounded-full border border-hairline bg-surface px-4 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/90 text-white transition hover:bg-brand disabled:opacity-50"
                aria-label="Send message"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
