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
  currentSession: SessionMeta | undefined | null
}

/**
 * Professional F1 Pit Wall Command Center header.
 *
 * Features:
 * - Racing-themed branding
 * - System health indicator
 * - Session/driver/mode controls
 * - Professional typography and gradients
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
    <header className="sticky top-0 z-50 border-b border-hairline bg-surface/95 backdrop-blur-xl">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {/* Top row: Branding + LIVE */}
        <div className="mb-6 flex items-center justify-between">
          {/* Branding */}
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-1.5 rounded-full bg-racing-gradient shadow-glow-red" />
            <div>
              <h1 className="mb-1 text-4xl font-black tracking-tight">
                <span className="bg-racing-gradient bg-clip-text text-transparent">
                  The Silent Co-Driver
                </span>
              </h1>
              <p className="text-xs font-medium tracking-wide text-ink-secondary">
                AI-Powered F1 Race Strategy System
              </p>
            </div>
          </div>

          {/* LIVE Indicator */}
          {health && health.offline_ready && (
            <div className="flex items-center gap-2.5 rounded-full bg-status-good/10 px-5 py-2.5 shadow-glow-green border border-status-good/20">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-status-good shadow-glow-green" />
              <span className="text-sm font-bold uppercase tracking-wider text-status-good">
                LIVE
              </span>
            </div>
          )}
        </div>

        {/* Control bar */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Session selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Race Session
            </label>
            <select
              value={sessionId ?? ''}
              onChange={(e) => onSessionChange(e.target.value)}
              className="rounded-lg border border-hairline bg-raised px-4 py-2.5 text-sm font-medium text-ink-primary shadow-sm transition-all hover:border-accent-cyan focus:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan/20"
            >
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.year} {s.event_name}
                </option>
              ))}
            </select>
          </div>

          {/* Driver selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Driver
            </label>
            <select
              value={driver}
              onChange={(e) => onDriverChange(e.target.value)}
              className="rounded-lg border border-hairline bg-raised px-4 py-2.5 text-sm font-medium text-ink-primary shadow-sm transition-all hover:border-accent-cyan focus:border-accent-cyan focus:outline-none focus:ring-2 focus:ring-accent-cyan/20"
            >
              {(currentSession?.drivers ?? [driver]).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Mode selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              AI Model
            </label>
            <div className="flex overflow-hidden rounded-lg border border-hairline bg-raised shadow-sm">
              {(['naive', 'fusion'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wide transition-all ${
                    mode === m
                      ? 'bg-accent-cyan/20 text-accent-cyan shadow-glow-cyan'
                      : 'text-ink-muted hover:bg-white/5 hover:text-ink-secondary'
                  }`}
                >
                  {m === 'naive' ? 'Single Model' : 'Fusion AI'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
