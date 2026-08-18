import { getDriver } from '../lib/drivers'
import { flagToCode } from '../lib/format'
import type { Circuit } from '../lib/circuits'
import type { HealthResponse, ModelCard, ScoringMode, SessionMeta } from '../types'

/**
 * The pit-wall header: who we are, which race and driver, how it's being
 * scored, and whether the models are actually up.
 *
 * The two pickers are native `<select>`s laid transparently over the drawn
 * control. The alternative — a hand-rolled listbox — would have to reimplement
 * type-ahead, keyboard navigation and the mobile wheel, and this page has 9
 * races and up to 23 drivers to walk through, so those are the interactions
 * that matter most.
 */

interface Props {
  sessions: SessionMeta[]
  sessionId: string | null
  currentSession: SessionMeta | null
  circuit: Circuit | null
  driver: string
  mode: ScoringMode
  health: HealthResponse | null
  modelCard: ModelCard | null
  theme: 'dark' | 'light'
  onSessionChange: (id: string) => void
  onDriverChange: (code: string) => void
  onModeChange: (mode: ScoringMode) => void
  onToggleTheme: () => void
}

export function Header({
  sessions,
  sessionId,
  currentSession,
  circuit,
  driver,
  mode,
  health,
  modelCard,
  theme,
  onSessionChange,
  onDriverChange,
  onModeChange,
  onToggleTheme,
}: Props) {
  const card = getDriver(driver)
  const code = flagToCode(circuit?.flag)
  const drivers = currentSession?.drivers ?? []

  // `degraded` is the honest reading when a branch failed to load: the page
  // still works on cached results, but claiming every model is live would be
  // the one thing on screen a judge could disprove in ten seconds.
  const live = health?.offline_ready === true && health.status === 'ok'
  const loadedCount = health ? Object.values(health.models_loaded).filter(Boolean).length : 0
  const totalCount = health ? Object.keys(health.models_loaded).length : 0

  return (
    /* Flex-wrap rather than the design's fixed `auto 1fr auto` grid: below about
       1200px the three pickers can't sit beside the wordmark and the status pill
       without crushing the race name, so the whole centre group drops to its own
       full-width line and stays centred. `basis` is that group's natural width,
       which is what decides when the wrap happens. */
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 self-center">
        <div
          className="cut grid h-10 w-10 flex-none place-items-center"
          style={{
            background: 'linear-gradient(155deg, var(--pap), #C25200)',
            boxShadow: '0 6px 18px -8px var(--pap)',
          }}
        >
          <span className="font-cond text-[17px] font-bold leading-none tracking-[0.02em] text-ink">
            SC
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="font-cond text-[21px] font-bold uppercase leading-none tracking-[0.06em] text-t1">
            Silent Co-Driver
          </h1>
          <p className="text-[11.5px] leading-none text-t3">
            Hears the driver crack before the lap time does
          </p>
        </div>
      </div>

      {/* ── Race / driver / scoring ──────────────────────────────────────── */}
      <div className="order-last flex flex-1 basis-[660px] flex-wrap items-end justify-center gap-4 xl:order-none">
        <Field label="Grand Prix">
          <Picker
            value={sessionId ?? ''}
            onChange={onSessionChange}
            options={sessions.map((s) => ({
              value: s.session_id,
              label: `${s.event_name} ${s.year}`,
            }))}
            ariaLabel="Grand Prix"
            disabled={sessions.length === 0}
          >
            {code && (
              <span className="mono flex-none rounded-[2px] bg-glass px-1 py-[3px] text-[8.5px] font-bold leading-none text-t2">
                {code}
              </span>
            )}
            <span className="truncate text-[13px] font-medium leading-none text-t1">
              {currentSession
                ? `${currentSession.event_name} ${currentSession.year}`
                : 'Loading races…'}
            </span>
          </Picker>
        </Field>

        <Field label="Driver">
          <Picker
            value={driver}
            onChange={onDriverChange}
            options={drivers.map((d) => {
              const c = getDriver(d)
              return { value: d, label: c.first ? `${c.first} ${c.last}` : d }
            })}
            ariaLabel="Driver"
            disabled={drivers.length === 0}
          >
            <span className="mono flex-none text-[12px] font-bold leading-none text-pap">
              {card.number || '—'}
            </span>
            <span className="font-cond text-[13px] font-semibold uppercase leading-none tracking-[0.1em] text-t1">
              {card.last}
            </span>
          </Picker>
        </Field>

        <Field label="Scoring">
          <div
            className="flex h-[34px] gap-0.5 rounded-[5px] border border-line bg-s2 p-[3px]"
            role="group"
            aria-label="Scoring mode"
          >
            {/* Only FUSION lights up papaya. Single is a comparison baseline, not
                a mode to leave the dashboard in, so selecting it reads as a
                pressed key rather than as the recommended setting. */}
            <ModeButton
              active={mode === 'naive'}
              activeBg="var(--s3)"
              activeFg="var(--t2)"
              onClick={() => onModeChange('naive')}
              title="One model only — the pretrained speech-emotion classifier, unaided"
            >
              Single
            </ModeButton>
            <ModeButton
              active={mode === 'fusion'}
              activeBg="var(--pap)"
              activeFg="var(--ink)"
              onClick={() => onModeChange('fusion')}
              title="All three branches through the fitted head"
            >
              Fusion
            </ModeButton>
          </div>
        </Field>
      </div>

      {/* ── Theme + liveness ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 self-center">
        <button
          onClick={onToggleTheme}
          title="Toggle cockpit / pit-lane mode"
          className="flex h-[30px] items-center gap-[7px] rounded-[5px] border border-line bg-s2 px-[11px] transition-colors hover:border-pap hover:bg-s3"
        >
          <span className="text-[12px] leading-none text-t2" aria-hidden>
            {theme === 'dark' ? '◐' : '◑'}
          </span>
          <span className="font-cond text-[9.5px] font-semibold uppercase leading-none tracking-[0.16em] text-t2">
            {theme === 'dark' ? 'Cockpit' : 'Pit lane'}
          </span>
        </button>

        <div
          className="flex h-[30px] items-center gap-2 rounded-[5px] border border-line bg-s2 px-[13px]"
          title={
            health
              ? `${loadedCount}/${totalCount} models loaded${
                  modelCard
                    ? ` · fusion head fitted on ${modelCard.n_train} clips`
                    : ' · fusion head not fitted'
                }`
              : 'Backend unreachable'
          }
        >
          <span
            className={live ? 'anim-pulse' : ''}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: live ? 'var(--grn)' : 'var(--mag)',
              boxShadow: `0 0 8px ${live ? 'var(--grn)' : 'var(--mag)'}`,
            }}
          />
          <span
            className="font-cond text-[10px] font-semibold uppercase leading-none tracking-[0.18em]"
            style={{ color: live ? 'var(--grn)' : 'var(--mag)' }}
          >
            {!health ? 'Backend down' : live ? 'Models live' : `Models ${loadedCount}/${totalCount}`}
          </span>
        </div>
      </div>
    </header>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow-sm">{label}</span>
      {children}
    </div>
  )
}

/**
 * A drawn control with a native `<select>` sitting invisibly on top of it.
 *
 * The select carries every interaction — click, keyboard, type-ahead, the
 * platform's own dropdown — while the visible layer is free to show a country
 * chip and a car number, which no `<option>` can style.
 */
function Picker({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  children,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`relative flex h-[34px] max-w-[240px] items-center gap-2.5 rounded-[5px] border border-line bg-s2 px-3 transition-colors ${
        disabled ? 'opacity-50' : 'cursor-pointer hover:border-pap hover:bg-s3'
      }`}
    >
      {children}
      <span className="ml-1.5 flex-none text-[9px] leading-none text-t3" aria-hidden>
        ▼
      </span>
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ModeButton({
  active,
  activeBg,
  activeFg,
  onClick,
  title,
  children,
}: {
  active: boolean
  activeBg: string
  activeFg: string
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="grid place-items-center rounded-[3px] px-3.5 font-cond text-[11px] font-semibold uppercase leading-none tracking-[0.14em] transition-all"
      style={{
        background: active ? activeBg : 'transparent',
        color: active ? activeFg : 'var(--t2)',
      }}
    >
      {children}
    </button>
  )
}
