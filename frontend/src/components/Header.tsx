import { CIRCUITS } from '../lib/circuits'
import { getDriver } from '../lib/drivers'
import type { HealthResponse, ScoringMode, SessionMeta } from '../types'
import { SelectMenu, type SelectOption } from './SelectMenu'

interface Props {
  sessions: SessionMeta[]
  sessionId: string | null
  driver: string
  mode: ScoringMode
  health: HealthResponse | null
  onSessionChange: (sessionId: string) => void
  onDriverChange: (driver: string) => void
  onModeChange: (mode: ScoringMode) => void
  currentSession: SessionMeta | null | undefined
  /** True while a session or driver change is in flight. */
  busy?: boolean
}

/**
 * The pit wall's controls: which race, which driver, which model.
 *
 * Three pickers and nothing else. Everything that used to sit up here as
 * decoration moved into the verdict band below, where it can carry a number.
 * On a phone the row wraps and each control keeps a 40px target rather than
 * collapsing into a menu — switching driver is the main thing anyone does with
 * this page, and it should never be two taps.
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
  busy = false,
}: Props) {
  const drivers = currentSession?.drivers ?? [driver]

  // Both pickers show the same identity twice: compact on the closed trigger,
  // then with the detail that helps you choose once the list is open. A code and
  // a year are enough to confirm a choice; they are not enough to make one.
  const sessionOptions: SelectOption[] = sessions.map((s) => {
    const c = CIRCUITS[s.session_id]
    return {
      value: s.session_id,
      text: s.event_name,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <Flag flag={c?.flag ?? '🏁'} />
          <span className="truncate">
            {s.event_name} <span className="text-ink-secondary">{s.year}</span>
          </span>
        </span>
      ),
      row: (
        <span className="flex min-w-0 items-center gap-2.5">
          <Flag flag={c?.flag ?? '🏁'} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight">{s.event_name}</span>
            <span className="mono block truncate text-[10px] leading-tight text-ink-muted">
              {s.year}
              {c && ` · ${c.short} · ${c.laps} laps`}
            </span>
          </span>
        </span>
      ),
    }
  })

  const driverOptions: SelectOption[] = drivers.map((code) => {
    const d = getDriver(code)
    return {
      value: code,
      text: d.last,
      accent: d.team.color,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <NumberChip n={d.number} color={d.team.color} />
          <span className="truncate">{d.last.toUpperCase()}</span>
        </span>
      ),
      row: (
        <span className="flex min-w-0 items-center gap-2.5">
          <NumberChip n={d.number} color={d.team.color} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight">
              {d.last.toUpperCase()}
              <span className="text-ink-muted"> {d.first}</span>
            </span>
            <span className="block truncate text-[10px] leading-tight text-ink-muted">
              {d.team.name}
            </span>
          </span>
        </span>
      ),
    }
  })

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-plane/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        {/* Wordmark. The tagline is the product description — it is the only
            place the page says what it does in plain words. */}
        <div className="flex min-w-0 items-center gap-3">
          <Mark />
          <div className="min-w-0">
            <p className="font-racing text-[20px] font-bold uppercase leading-none tracking-tight text-ink-primary">
              Silent Co-Driver
            </p>
            <p className="mt-1.5 truncate text-[12px] leading-none text-ink-secondary">
              Hears the driver crack before the lap time does
            </p>
          </div>
        </div>

        {/* Full-width and left-aligned once the row wraps: right-aligned
            controls under a left-aligned wordmark read as two unrelated bars. */}
        <div className="flex w-full flex-wrap items-end gap-2 sm:ml-auto sm:w-auto sm:flex-1 sm:justify-end sm:gap-3">
          <SelectMenu
            label="Grand Prix"
            value={sessionId ?? ''}
            options={sessionOptions}
            onChange={onSessionChange}
            className="flex-[1_1_190px] sm:flex-none sm:w-[218px]"
            menuClassName="max-w-[min(320px,calc(100vw-2rem))]"
          />

          <SelectMenu
            label="Driver"
            value={driver}
            options={driverOptions}
            onChange={onDriverChange}
            className="flex-[1_1_150px] sm:flex-none sm:w-[178px]"
            menuClassName="max-w-[min(290px,calc(100vw-2rem))]"
          />

          <div className="flex flex-col gap-1">
            <span className="field-label">Scoring</span>
            {/* Glass too, or it reads as a solid block wedged between two panes
                of glass — the three controls are one row and have to agree. */}
            <div
              className="control-glass cursor-default overflow-hidden p-0"
              role="group"
              aria-label="Scoring model"
            >
              {(['naive', 'fusion'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  aria-pressed={mode === m}
                  className="h-full px-3.5 text-[11px] font-bold uppercase tracking-wider transition"
                  style={
                    mode === m
                      ? { background: 'rgba(0,217,255,0.16)', color: 'var(--accent-cyan)' }
                      : { color: 'var(--slate)' }
                  }
                >
                  {m === 'naive' ? 'Single' : 'Fusion'}
                </button>
              ))}
            </div>
          </div>

          <Status health={health} busy={busy} />
        </div>
      </div>
    </header>
  )
}

/** Country flag on a glass tile, so the emoji sits on the design instead of
 *  floating in the middle of a text run at whatever size the OS renders it. */
function Flag({ flag }: { flag: string }) {
  return (
    <span
      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border text-[12px] leading-none"
      style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.055)' }}
      aria-hidden
    >
      {flag}
    </span>
  )
}

/** The car number in livery colour — how a driver is identified on a timing
 *  tower, and readable a row at a time in a way three letters is not. */
function NumberChip({ n, color }: { n: number; color: string }) {
  if (n <= 0) return null
  return (
    <span
      className="tower grid h-[22px] min-w-[26px] shrink-0 place-items-center rounded-[6px] border px-1 text-[13px]"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
      aria-hidden
    >
      {n}
    </span>
  )
}

function Mark() {
  return (
    <span
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{
        background: 'linear-gradient(150deg, #00E5FF 0%, #00d9ff 55%, #0099b3 100%)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.3) inset, 0 8px 20px -10px rgba(0,217,255,0.6)',
      }}
      aria-hidden
    >
      {/* A radio wave leaving a helmet: the input, not a generic bolt. */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
        <path d="M4 14v-2a7 7 0 0 1 10.5-6" strokeLinecap="round" />
        <rect x="3" y="13" width="4" height="6" rx="1.4" fill="#fff" stroke="none" />
        <path d="M17 6.5a7.5 7.5 0 0 1 0 11M20 3.5a11.5 11.5 0 0 1 0 17" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function Status({ health, busy }: { health: HealthResponse | null; busy: boolean }) {
  const ready = health?.offline_ready === true
  const tone = busy ? 'var(--status-warning)' : ready ? 'var(--status-good)' : 'var(--slate)'
  const text = busy ? 'Loading' : ready ? 'Models live' : 'Waiting'

  return (
    <span
      className="hidden items-center gap-2 self-end rounded-full border px-3 py-2 md:inline-flex"
      style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, color: tone }}
      title={
        health
          ? `${Object.values(health.models_loaded).filter(Boolean).length} of ${
              Object.keys(health.models_loaded).length
            } models loaded`
          : 'Backend not reachable'
      }
    >
      <span
        className={busy ? 'anim-pulse' : ''}
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: 'currentColor',
          boxShadow: '0 0 10px currentColor',
        }}
      />
      <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{text}</span>
    </span>
  )
}
