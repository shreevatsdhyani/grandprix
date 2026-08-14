import type { HealthResponse, SessionMeta } from '../types'

interface Props {
  sessions: SessionMeta[]
  sessionId: string | null
  driver: string
  mode: 'naive' | 'fusion'
  health: HealthResponse | null
  onSessionChange: (sessionId: string) => void
  onDriverChange: (driver: string) => void
  onModeChange: (mode: 'naive' | 'fusion') => void
  currentSession: SessionMeta | null | undefined
}

/**
 * Premium F1 Command Center Header
 *
 * Glassmorphism design with:
 * - Gradient background with radial glow
 * - Compact, dense layout
 * - Animated LIVE badge with pulse glow
 * - Gradient border separator
 * - Logo mark for visual anchoring
 * - Professional type hierarchy
 */
export function Header({
  sessions,
  sessionId,
  driver,
  mode,
  health,
  onSessionChange,
  onDriverChange,
  onModeChange,
  currentSession,
}: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent backdrop-blur-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(10, 10, 10, 0.95) 0%, rgba(20, 15, 15, 0.98) 50%, rgba(10, 10, 10, 0.95) 100%)',
        borderImageSource: 'linear-gradient(90deg, transparent 0%, rgba(255, 0, 80, 0.3) 50%, transparent 100%)',
        borderImageSlice: 1,
      }}
    >
      {/* Radial glow accent */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-[120px]" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-accent-cyan/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-[1600px] px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Left: Branding with logo mark */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo mark */}
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 bg-racing-gradient rounded-lg blur-md opacity-60" />
              <div className="relative h-9 w-9 rounded-lg bg-racing-gradient flex items-center justify-center">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>

            {/* Brand text */}
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/70 mb-0.5">
                AI-Powered Race Strategy System
              </p>
              <h1 className="text-xl font-black tracking-tight text-white">
                The Silent Co-Driver
              </h1>
            </div>
          </div>

          {/* Center: Controls */}
          <div className="flex items-center gap-3 flex-1 justify-center max-w-3xl">
            {/* Session */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
                Session
              </label>
              <select
                value={sessionId ?? ''}
                onChange={(e) => onSessionChange(e.target.value)}
                className="h-9 rounded-lg border border-hairline/50 bg-raised/80 backdrop-blur-sm px-3 text-xs font-medium text-ink-primary shadow-sm transition-all hover:border-accent-cyan/50 hover:bg-raised focus:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan/20"
              >
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.year} {s.event_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Driver */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
                Driver
              </label>
              <select
                value={driver}
                onChange={(e) => onDriverChange(e.target.value)}
                className="h-9 rounded-lg border border-hairline/50 bg-raised/80 backdrop-blur-sm px-3 text-xs font-medium text-ink-primary shadow-sm transition-all hover:border-accent-cyan/50 hover:bg-raised focus:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan/20"
              >
                {(currentSession?.drivers ?? [driver]).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* AI Model */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
                AI Model
              </label>
              <div className="flex h-9 overflow-hidden rounded-lg border border-hairline/50 bg-raised/80 backdrop-blur-sm shadow-sm">
                {(['naive', 'fusion'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => onModeChange(m)}
                    className={`px-4 text-[10px] font-bold uppercase tracking-wide transition-all ${
                      mode === m
                        ? 'bg-accent-cyan/20 text-accent-cyan shadow-glow-cyan'
                        : 'text-ink-muted hover:bg-white/5 hover:text-ink-secondary'
                    }`}
                  >
                    {m === 'naive' ? 'Single' : 'Fusion'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: LIVE badge */}
          {health && health.offline_ready && (
            <div className="relative flex-shrink-0">
              {/* Animated glow */}
              <div className="absolute inset-0 rounded-full bg-status-good/30 blur-xl animate-pulse" />

              {/* Badge */}
              <div className="relative flex items-center gap-2 rounded-full border border-status-good/30 bg-status-good/10 px-4 py-2 backdrop-blur-sm">
                {/* Pulsing dot */}
                <div className="relative h-2 w-2">
                  <div className="absolute inset-0 rounded-full bg-status-good animate-ping" />
                  <div className="relative h-2 w-2 rounded-full bg-status-good" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-status-good">
                  LIVE
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gradient border bottom */}
      <div
        className="h-[1px] w-full"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0, 217, 255, 0.3) 50%, transparent 100%)'
        }}
      />
    </header>
  )
}
