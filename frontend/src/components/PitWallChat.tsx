import { useEffect, useRef, useState } from 'react'

/**
 * Premium F1 Pit Wall AI Assistant
 *
 * Professional chat interface with:
 * - Racing-themed design
 * - Floating trigger with glow effects
 * - Suggested questions with racing UI
 * - Auto-scroll & smooth animations
 * - Tool transparency with badges
 * - Premium typography & spacing
 *
 * Feature-flagged on backend (GP_AGENT=1).
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
  { q: 'When did stress peak?', icon: '📈' },
  { q: 'Was stress correlated with pace?', icon: '🔗' },
  { q: 'Find the most stressed moments', icon: '🔍' },
  { q: 'What did the driver say at the highest stress lap?', icon: '🎙️' },
  { q: 'Analyze the lead-lag relationship', icon: '📊' },
]

export function PitWallChat({ sessionId, driver }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading, isOpen])

  // Reset on session/driver change
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [sessionId, driver])

  async function sendMessage(question: string) {
    if (!question.trim() || loading || !sessionId) return

    setInput('')
    setError(null)

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
          setAvailable(false)
          throw new Error('AI Agent not enabled on backend')
        }
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status} ${res.statusText}`)
      }

      const data = await res.json()

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

  if (!available) return null
  if (!sessionId) return null

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-8 right-8 z-50 group"
          aria-label="Open pit wall AI assistant"
        >
          {/* Outer glow ring */}
          <div className="absolute inset-0 rounded-full bg-racing-gradient blur-xl opacity-50 group-hover:opacity-70 transition-opacity" />

          {/* Main button */}
          <div className="relative h-16 w-16 rounded-full bg-racing-gradient shadow-2xl flex items-center justify-center transform transition-all group-hover:scale-110">
            <svg
              className="h-8 w-8 text-white"
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

            {/* Pulse indicator for new users */}
            {messages.length === 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-good opacity-75" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-status-good shadow-glow-green" />
              </span>
            )}
          </div>

          {/* Tooltip */}
          <span className="absolute bottom-full mb-2 right-0 px-3 py-1.5 bg-surface/95 backdrop-blur rounded-lg border border-hairline text-xs font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
            Ask the Pit Wall AI
          </span>
        </button>
      )}

      {/* Chat Modal */}
      {isOpen && (
        <div className="fixed bottom-8 right-8 z-50 flex h-[600px] w-[400px] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface/98 backdrop-blur-xl shadow-2xl animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="relative border-b border-hairline bg-gradient-to-r from-surface via-raised to-surface px-5 py-4">
            {/* Racing stripe accent */}
            <div className="absolute left-0 top-0 h-full w-1 bg-racing-gradient-vertical" />

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase tracking-wider">
                  <span className="bg-racing-gradient bg-clip-text text-transparent">
                    AI Pit Wall
                  </span>
                </h3>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                  The Silent Co-Driver • {driver} • {sessionId}
                </p>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-2 text-ink-muted transition-all hover:bg-raised hover:text-ink-primary"
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
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Welcome & Suggestions */}
            {messages.length === 0 && !loading && (
              <div className="space-y-4">
                {/* Welcome message */}
                <div className="rounded-xl border border-accent-cyan/20 bg-accent-cyan/5 p-4">
                  <p className="text-sm font-medium text-ink-primary">
                    🏎️ AI Pit Wall - Your Silent Co-Driver
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                    I can analyze {driver}'s stress levels, lap performance, radio transcripts, and correlations between stress and pace.
                  </p>
                </div>

                {/* Suggested questions */}
                <div>
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                    Quick Questions
                  </p>
                  <div className="space-y-2">
                    {SUGGESTED_QUESTIONS.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(item.q)}
                        className="w-full group flex items-center gap-3 rounded-lg border border-hairline bg-raised/50 px-4 py-3 text-left transition-all hover:border-accent-cyan/50 hover:bg-accent-cyan/10 hover:shadow-glow-cyan"
                      >
                        <span className="text-xl">{item.icon}</span>
                        <span className="flex-1 text-sm font-medium text-ink-secondary group-hover:text-accent-cyan transition-colors">
                          {item.q}
                        </span>
                        <svg
                          className="h-4 w-4 text-ink-muted group-hover:text-accent-cyan transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Message History */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'rounded-br-none bg-gradient-to-br from-brand/30 to-accent-cyan/20 border border-brand/30 shadow-glow-red'
                      : 'rounded-bl-none border border-hairline bg-raised/80 backdrop-blur'
                  }`}
                >
                  {/* Role label */}
                  <div className="mb-1.5 flex items-center gap-2">
                    {msg.role === 'user' ? (
                      <>
                        <svg className="h-3.5 w-3.5 text-brand" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-brand">You</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5 text-accent-cyan" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-accent-cyan">AI Engineer</span>
                      </>
                    )}
                  </div>

                  {/* Message content */}
                  <p className="text-sm leading-relaxed text-ink-primary">{msg.content}</p>

                  {/* Tool badges */}
                  {msg.tools_used && msg.tools_used.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {msg.tools_used.map((tool, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-ink-muted"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {tool.replace('get_', '').replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-none border border-hairline bg-raised/80 backdrop-blur px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex space-x-1">
                      <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent-cyan" style={{ animationDelay: '0ms' }} />
                      <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent-cyan" style={{ animationDelay: '150ms' }} />
                      <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent-cyan" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs font-medium text-ink-muted">Analyzing race data...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="rounded-xl border border-status-critical/40 bg-status-critical/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 text-status-critical" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-xs font-semibold text-status-critical">Error</p>
                    <p className="mt-1 text-xs text-ink-muted">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-hairline bg-gradient-to-r from-surface via-raised to-surface p-4">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about stress, pace, or radio..."
                disabled={loading}
                className="flex-1 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-primary placeholder:text-ink-muted focus:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan/20 disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-racing-gradient text-white shadow-glow-red transition-all hover:shadow-glow-cyan disabled:opacity-50 disabled:shadow-none"
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
