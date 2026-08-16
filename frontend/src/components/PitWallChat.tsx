import { useEffect, useRef, useState } from 'react'
import { CHAT, UI } from '../constants'

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
          className="fixed bottom-8 right-8 group"
          style={{ zIndex: UI.Z_CHAT }}
          aria-label="Open pit wall AI assistant"
        >
          {/* Glassmorphism background ring */}
          <div
            className="absolute inset-[-10px] rounded-full backdrop-blur-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 15, 15, 0.9) 0%, rgba(20, 20, 20, 0.85) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            }}
          />

          {/* Animated outer glow */}
          <div
            className="absolute inset-0 rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse"
            style={{
              background: 'radial-gradient(circle, rgba(255, 0, 80, 0.6) 0%, rgba(0, 217, 255, 0.3) 100%)',
            }}
          />

          {/* Main gradient button */}
          <div
            className="relative rounded-full flex items-center justify-center transform transition-all group-hover:scale-105"
            style={{
              width: `${UI.CHAT_BUTTON_SIZE}px`,
              height: `${UI.CHAT_BUTTON_SIZE}px`,
              background: 'linear-gradient(135deg, #ff0050 0%, #00d9ff 100%)',
              boxShadow: '0 4px 20px rgba(255, 0, 80, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
            }}
          >
            <svg
              className="text-white"
              style={{ width: `${UI.CHAT_ICON_SIZE}px`, height: `${UI.CHAT_ICON_SIZE}px` }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>

            {/* Pulse badge for new users */}
            {messages.length === 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-good opacity-75" />
                <span
                  className="relative inline-flex h-4 w-4 rounded-full bg-status-good"
                  style={{ boxShadow: '0 0 12px rgba(0, 255, 136, 0.8)' }}
                />
              </span>
            )}
          </div>

          {/* Glassmorphism tooltip */}
          <span
            className="absolute bottom-full mb-3 right-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 15, 15, 0.95) 0%, rgba(20, 20, 20, 0.9) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            }}
          >
            Ask the Pit Wall
          </span>
        </button>
      )}

      {/* Chat Modal */}
      {isOpen && (
        <div
          className={`fixed bottom-8 right-8 flex flex-col overflow-hidden rounded-2xl animate-in slide-in-from-bottom-4`}
          style={{
            zIndex: UI.Z_CHAT,
            width: `${UI.CHAT_WIDTH}px`,
            height: `${UI.CHAT_HEIGHT}px`,
            background: 'linear-gradient(145deg, rgba(15, 15, 15, 0.85) 0%, rgba(10, 10, 10, 0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 0, 80, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          }}
        >
          {/* Glassmorphism Header */}
          <div
            className="relative px-4 py-3.5 backdrop-blur-md"
            style={{
              background: 'linear-gradient(145deg, rgba(20, 20, 20, 0.7) 0%, rgba(15, 15, 15, 0.8) 100%)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {/* Subtle gradient accent */}
            <div
              className="absolute left-0 top-0 h-full w-[3px]"
              style={{
                background: 'linear-gradient(180deg, rgba(255, 0, 80, 0.6) 0%, rgba(0, 217, 255, 0.4) 100%)',
                boxShadow: '0 0 12px rgba(255, 0, 80, 0.3)',
              }}
            />

            <div className="flex items-start justify-between gap-3">
              {/* Icon + Text */}
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {/* Refined icon in gradient circle */}
                <div className="relative flex-shrink-0 mt-0.5">
                  <div
                    className="absolute inset-0 rounded-full blur-lg"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 0, 80, 0.4) 0%, transparent 70%)',
                    }}
                  />
                  <div
                    className="relative h-9 w-9 rounded-full flex items-center justify-center"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 0, 80, 0.2) 0%, rgba(0, 217, 255, 0.1) 100%)',
                      border: '1px solid rgba(255, 0, 80, 0.3)',
                    }}
                  >
                    <svg className="h-4.5 w-4.5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                  </div>
                </div>

                {/* Text hierarchy */}
                <div className="flex-1 min-w-0">
                  <h3 className="mb-1 text-base font-bold tracking-tight text-white">
                    AI Pit Wall
                  </h3>
                  <p className="text-[10px] font-medium text-ink-muted leading-relaxed">
                    The Silent Co-Driver • {driver}
                  </p>
                  <p className="mt-1.5 text-[10px] leading-snug text-ink-muted">
                    Stress, pace, transcripts & correlations
                  </p>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={() => setIsOpen(false)}
                className="flex-shrink-0 rounded-lg p-1.5 text-ink-muted transition-all hover:bg-white/5 hover:text-ink-primary"
                aria-label="Close chat"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            {/* Suggested Questions */}
            {messages.length === 0 && !loading && (
              <div className="space-y-4">
                {/* Suggested questions */}
                <div>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    Quick Questions
                  </p>
                  <div className="space-y-2">
                    {SUGGESTED_QUESTIONS.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(item.q)}
                        className="relative w-full group flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-left transition-all hover:border-accent-cyan/30 hover:bg-accent-cyan/5"
                      >
                        {/* Animated left accent bar */}
                        <div
                          className="absolute left-0 top-0 h-full w-[2px] rounded-r-full bg-accent-cyan opacity-0 group-hover:opacity-100 transition-all"
                          style={{
                            boxShadow: '0 0 8px rgba(0, 217, 255, 0.6)',
                          }}
                        />

                        <span className="text-base">{item.icon}</span>
                        <span className="flex-1 text-xs font-medium text-ink-secondary group-hover:text-ink-primary transition-colors">
                          {item.q}
                        </span>
                        <svg
                          className="h-3.5 w-3.5 text-ink-muted group-hover:text-accent-cyan transition-all group-hover:translate-x-0.5"
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
