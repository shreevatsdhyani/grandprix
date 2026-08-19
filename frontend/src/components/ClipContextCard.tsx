import type { ClipContext, TrackZone } from '../types'

/**
 * The moment around a radio call.
 *
 * A transcript alone leaves the engineer to guess what the driver was reacting
 * to. This is the answer: which corner, how fast, what the tyres were, what the
 * track was doing, and who was around them — all resolved from the call's exact
 * broadcast timestamp.
 *
 * Laid out as a timing-screen data block rather than prose, because that is how
 * this information is read on a pit wall: label above value, fixed columns,
 * tabular figures so the numbers line up when you flick between calls.
 */

const ZONE_WORD: Record<TrackZone, string> = {
  braking: 'braking zone',
  high_speed: 'high speed',
  corner: 'in a corner',
  pit_lane: 'pit lane',
  other: 'on track',
}

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: '#FF3333',
  MEDIUM: '#FFD12E',
  HARD: '#EDEDED',
  INTERMEDIATE: '#43B02A',
  WET: '#0067AD',
}

/** FIA flag colours. Borrowed, not invented — the audience already reads them. */
const FLAG_COLOR: Record<string, string> = {
  YELLOW: '#FFD800',
  DOUBLE_YELLOW: '#FFD800',
  BLUE: '#0067AD',
  RED: '#E10600',
  GREEN: '#00A650',
  CLEAR: '#00A650',
  CHEQUERED: '#EDEDED',
  BLACK_AND_WHITE: '#EDEDED',
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mono tabular mt-0.5 truncate text-[12px] text-ink">{children}</p>
    </div>
  )
}

export function ClipContextCard({ context }: { context: ClipContext | null }) {
  if (!context) return null

  const { position: pos, tyre, track, situation: sit, phase } = context

  // Grid and post-flag radio has no lap, no tyre state and no track position —
  // and saying so is more useful than an empty grid, because it reframes a high
  // stress reading as something other than race pressure.
  if (phase && phase !== 'racing') {
    const word = phase === 'pre_race' ? 'before the start' : 'after the chequered flag'
    return (
      <div className="mt-3 rounded-lg border border-hairline bg-raised px-3 py-2.5">
        <p className="eyebrow">When</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink">
          Transmitted {word} — on the grid or the cool-down lap.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
          There is no lap, tyre or track position for this call, and its stress score is not a
          reading of race pressure.
          {track?.track_temp_c != null && ` Track was ${track.track_temp_c.toFixed(1)}°C.`}
        </p>
      </div>
    )
  }

  const hasPosition = pos?.nearest_corner != null || pos?.distance_into_lap_m != null

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-hairline bg-raised">
      <div className="flex items-baseline justify-between gap-2 border-b border-hairline px-3 py-2">
        <p className="eyebrow">The moment</p>
        {context.lap != null && (
          <span className="tower text-ink-muted" style={{ fontSize: 12 }}>
            LAP {context.lap}
          </span>
        )}
      </div>

      <div className="space-y-3 px-3 py-2.5">
        {hasPosition && (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Cell label="Where">
              {pos?.nearest_corner != null ? (
                <>
                  Turn {pos.nearest_corner}
                  {pos.distance_to_corner_m != null && (
                    <span className="text-ink-muted">
                      {' '}
                      {pos.distance_to_corner_m > 0 ? 'approach' : 'exit'}
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </Cell>
            <Cell label="Into lap">
              {pos?.distance_into_lap_m != null
                ? `${Math.round(pos.distance_into_lap_m)} m`
                : '—'}
              {pos?.pct_of_lap != null && (
                <span className="text-ink-muted"> · {pos.pct_of_lap.toFixed(0)}%</span>
              )}
            </Cell>
            <Cell label="Sector">{pos?.sector != null ? `S${pos.sector}` : '—'}</Cell>

            <Cell label="Speed">
              {pos?.speed_kph != null ? `${pos.speed_kph.toFixed(0)} kph` : '—'}
            </Cell>
            <Cell label="Throttle">
              {pos?.throttle_pct != null ? `${pos.throttle_pct.toFixed(0)}%` : '—'}
              {pos?.brake && <span className="ml-1 text-status-critical">brake</span>}
            </Cell>
            <Cell label="Gear">
              {pos?.gear ?? '—'}
              {pos?.drs_active && <span className="ml-1 text-accent-cyan">DRS</span>}
            </Cell>
          </div>
        )}

        {pos?.zone && (
          <p className="text-[11px] text-ink-muted">
            {ZONE_WORD[pos.zone]}
            {pos.rpm != null && ` · ${pos.rpm.toLocaleString()} rpm`}
          </p>
        )}

        {/* Tyre and track share a row: they are the two things the driver was
            fighting, and reading them together is the point. */}
        <div className="grid grid-cols-2 gap-x-3 border-t border-hairline pt-2.5">
          <div className="min-w-0">
            <p className="eyebrow">Tyre</p>
            {tyre?.compound ? (
              <>
                <p className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: COMPOUND_COLOR[tyre.compound.toUpperCase()] ?? '#7A7A7A' }}
                    aria-hidden
                  />
                  <span className="mono truncate text-[12px] text-ink">
                    {tyre.compound}
                    {tyre.tyre_age_laps != null && (
                      <span className="text-ink-muted"> · {tyre.tyre_age_laps} laps old</span>
                    )}
                  </span>
                </p>
                {tyre.deg_slope_s_per_lap != null && (
                  <p className="mono tabular mt-0.5 text-[10px] text-ink-muted">
                    {tyre.deg_slope_s_per_lap >= 0 ? '+' : ''}
                    {tyre.deg_slope_s_per_lap.toFixed(3)} s/lap modelled
                    {tyre.past_cliff && (
                      <span className="ml-1 text-status-warning">past cliff</span>
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="mono mt-0.5 text-[12px] text-ink-muted">—</p>
            )}
          </div>

          <div className="min-w-0">
            <p className="eyebrow">Track</p>
            <p className="mono tabular mt-0.5 truncate text-[12px] text-ink">
              {track?.track_temp_c != null ? `${track.track_temp_c.toFixed(1)}°C` : '—'}
              {track?.rainfall === true && (
                <span className="ml-1" style={{ color: COMPOUND_COLOR.WET }}>
                  wet
                </span>
              )}
            </p>
            {track?.track_temp_delta_from_start_c != null && (
              <p className="mono tabular mt-0.5 text-[10px] text-ink-muted">
                {track.track_temp_delta_from_start_c >= 0 ? '+' : ''}
                {track.track_temp_delta_from_start_c.toFixed(1)}° vs start
              </p>
            )}
          </div>
        </div>

        {sit && (sit.position != null || sit.active_flags.length > 0) && (
          <div className="border-t border-hairline pt-2.5">
            <p className="eyebrow">Race</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {sit.position != null && (
                <span className="mono tabular text-[12px] text-ink">P{sit.position}</span>
              )}
              {sit.gap_ahead_s != null && (
                <span className="mono tabular text-[11px] text-ink-muted">
                  {sit.gap_ahead_s.toFixed(1)}s to car ahead
                </span>
              )}
              {sit.gap_to_leader_s != null && sit.position !== 1 && (
                <span className="mono tabular text-[11px] text-ink-muted">
                  {sit.gap_to_leader_s.toFixed(1)}s to leader
                </span>
              )}
              {sit.in_traffic && (
                <span className="mono text-[10px] uppercase tracking-wide text-status-warning">
                  in traffic
                </span>
              )}
            </div>

            {sit.active_flags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sit.active_flags.map((f) => (
                  <span
                    key={f}
                    className="mono rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-plane"
                    style={{ background: FLAG_COLOR[f.toUpperCase()] ?? '#7A8290' }}
                  >
                    {f.replace(/_/g, ' ')} flag
                  </span>
                ))}
              </div>
            )}

            {/* The two closest race-control messages. More would bury the call. */}
            {sit.nearby_messages.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {[...sit.nearby_messages]
                  .sort((a, b) => Math.abs(a.offset_s) - Math.abs(b.offset_s))
                  .slice(0, 2)
                  .map((m, i) => (
                    <li key={i} className="text-[10px] leading-relaxed text-ink-muted">
                      <span className="mono tabular">
                        {m.offset_s >= 0 ? '+' : ''}
                        {m.offset_s.toFixed(0)}s
                      </span>{' '}
                      {m.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
