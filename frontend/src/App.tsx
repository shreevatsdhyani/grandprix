import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  analyseClip,
  analyseViaWebSocket,
  getFindings,
  getHealth,
  getSessions,
  getTimeline,
} from './api'
import { BaselineBand } from './components/BaselineBand'
import { ClipBrowser } from './components/ClipBrowser'
import { ComponentErrorBoundary, ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { LeadLagPanel } from './components/LeadLagPanel'
import { PitWallChat } from './components/PitWallChat'
import { RaceTimeline } from './components/RaceTimeline'
import { RadioInspector } from './components/RadioInspector'
import { SignalBars } from './components/SignalBars'
import { StartLights } from './components/StartLights'
import { BiometricsPanel } from './components/BiometricsPanel'
import { StrategyCalls } from './components/StrategyCalls'
import { TopFindings } from './components/TopFindings'
import { TrackConditions } from './components/TrackConditions'
import { TrackTrace } from './components/TrackTrace'
import { TyreStints } from './components/TyreStints'
import { VerdictHero } from './components/VerdictHero'
import { getCircuit } from './lib/circuits'
import { getDriver } from './lib/drivers'
import { readVerdict } from './lib/verdict'
import type {
  BiometricSeries,
  ClipAnalysis,
  FindingsResponse,
  HealthResponse,
  ProgressEvent,
  ScoringMode,
  SessionMeta,
  Timeline,
} from './types'

/**
 * Hold a transient state on screen for a minimum time.
 *
 * Cached sessions resolve in under 100ms, and a loader that appears and
 * vanishes inside two frames reads as a flicker, not as feedback. Switching
 * driver is the main interaction on this page, so it gets a beat long enough to
 * register as "that worked" — and the beat is the same length whether the
 * answer came from cache or from a cold read.
 */
function useHeldFlag(active: boolean, ms = 620): boolean {
  const [held, setHeld] = useState(active)

  useEffect(() => {
    if (active) {
      setHeld(true)
      return
    }
    const id = setTimeout(() => setHeld(false), ms)
    return () => clearTimeout(id)
  }, [active, ms])

  return held
}

function AppContent() {
  const [mode, setMode] = useState<ScoringMode>('fusion')
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [driver, setDriver] = useState('HAM')
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [timelineLoaded, setTimelineLoaded] = useState(false)
  const [findings, setFindings] = useState<FindingsResponse | null>(null)
  const [findingsLoading, setFindingsLoading] = useState(false)
  const [findingsError, setFindingsError] = useState<string | null>(null)
  // Set false on a 404, i.e. GP_AGENT is off, and never re-armed for the session.
  const [findingsAvailable, setFindingsAvailable] = useState(true)
  // Bumped by the panel's "regenerate" control to re-run the effect.
  const [findingsNonce, setFindingsNonce] = useState(0)
  // Set by a biometrics upload so the panel updates without a timeline refetch.
  // Cleared whenever the session or driver changes, since it belongs to one pair.
  const [biometrics, setBiometrics] = useState<BiometricSeries | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<ClipAnalysis | null>(null)
  const [uploadLap, setUploadLap] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live-analysis stream state. `analysed` holds results that came back over the
  // WebSocket, keyed by clip_id: the timeline is only refetched on
  // session/driver/mode change, so a freshly analysed clip would otherwise
  // vanish from the inspector the moment the stream closed.
  const [progress, setProgress] = useState<ProgressEvent[]>([])
  const [streamingClipId, setStreamingClipId] = useState<string | null>(null)
  const [analysed, setAnalysed] = useState<Record<string, ClipAnalysis>>({})
  const [libraryVersion, setLibraryVersion] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)

  // Sessions come from the backend rather than a constant, so the picker works
  // against whatever races are actually cached on this machine.
  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
    getSessions()
      .then((list) => {
        setSessions(list)
        setSessionId((prev) => prev ?? list[0]?.session_id ?? null)
      })
      .catch((e: Error) => setError(`Could not load sessions: ${e.message}`))
  }, [])

  const session = sessions.find((s) => s.session_id === sessionId) ?? null

  // Keep the driver valid when the race changes — not every driver started
  // every race, and requesting a missing one 404s.
  useEffect(() => {
    if (session && !session.drivers.includes(driver)) {
      setDriver(session.drivers.includes('HAM') ? 'HAM' : session.drivers[0])
    }
  }, [session, driver])

  // Findings are fetched separately from the timeline rather than embedded in it.
  // They take seconds (an LLM call) against the timeline's tens of milliseconds,
  // so blocking the chart on them would make every driver switch feel broken.
  useEffect(() => {
    if (!sessionId) return
    let live = true
    setFindings(null)
    setFindingsError(null)
    setFindingsLoading(true)
    // A nonce above zero means the user pressed "regenerate", so bypass the
    // server-side cache — otherwise the button would re-read the same answer.
    getFindings(sessionId, driver, mode, { refresh: findingsNonce > 0 })
      .then((f) => {
        if (live) setFindings(f)
      })
      .catch((e: unknown) => {
        if (!live) return
        // 404 = the agent layer is off entirely (GP_AGENT != 1). Hide the panel
        // rather than showing an error, matching how PitWallChat retires itself.
        if (e instanceof ApiError && e.status === 404) {
          setFindingsAvailable(false)
          return
        }
        setFindingsError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (live) setFindingsLoading(false)
      })
    return () => {
      live = false
    }
  }, [sessionId, driver, mode, findingsNonce])

  useEffect(() => {
    setBiometrics(null)
  }, [sessionId, driver])

  useEffect(() => {
    if (!sessionId) return
    let live = true
    setTimelineLoaded(false)
    setTimeline(null)
    getTimeline(sessionId, driver, mode)
      .then((t) => {
        if (!live) return
        setTimeline(t)
        setTimelineLoaded(true)
        setError(null)
        setSelectedClipId(t.clips.at(-1)?.clip_id ?? null)
      })
      .catch((e: Error) => {
        if (!live) return
        setTimelineLoaded(true)
        setError(e.message)
      })
    return () => {
      live = false
    }
  }, [sessionId, driver, mode])

  const selectedClip = useMemo(() => {
    if (uploaded && uploaded.clip_id === selectedClipId) return uploaded
    if (selectedClipId && analysed[selectedClipId]) return analysed[selectedClipId]
    return timeline?.clips.find((c) => c.clip_id === selectedClipId) ?? null
  }, [timeline, selectedClipId, uploaded, analysed])

  // Close any open socket on unmount, and whenever the run is superseded. An
  // orphaned socket keeps a worker thread busy on the backend and would push
  // stage events for a clip nobody is looking at any more.
  const closeSocket = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
  }, [])

  useEffect(() => closeSocket, [closeSocket])

  const streamAnalysis = useCallback(
    (clipId: string) => {
      if (!clipId || clipId.startsWith('upload-')) return
      closeSocket()
      setProgress([])
      setStreamingClipId(clipId)
      setError(null)

      socketRef.current = analyseViaWebSocket(clipId, {
        onProgress: (event) => setProgress((prev) => [...prev, event]),
        onResult: (result) => {
          setAnalysed((prev) => ({ ...prev, [result.clip_id]: result }))
          setSelectedClipId(result.clip_id)
          setStreamingClipId(null)
          // The backend cached this result, so the library's badges and the
          // analysed/total counter are now behind by one.
          setLibraryVersion((v) => v + 1)
          socketRef.current = null
        },
        onError: (message) => {
          setError(message)
          setStreamingClipId(null)
          socketRef.current = null
        },
      })
    },
    [closeSocket],
  )

  async function handleUpload(file: File) {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const lap = uploadLap ? parseInt(uploadLap, 10) : undefined
      const result = await analyseClip(file, driver, sessionId, lap)
      setUploaded(result)
      setSelectedClipId(result.clip_id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function handleBrowseSelect(clipId: string) {
    setSelectedClipId(clipId)
    setProgress([])

    // Already analysed — from the timeline's cache or an earlier stream — so
    // show it instantly rather than paying ~13s to recompute the same answer.
    const known =
      timeline?.clips.some((c) => c.clip_id === clipId) || analysed[clipId] != null
    if (known) {
      closeSocket()
      setStreamingClipId(null)
      return
    }

    // Unanalysed: run it now and stream the stages. This is what makes the 446
    // curated clips reachable — the timeline only plots clips that already have
    // a cached analysis, so before this there was no way to create one from the
    // UI except by uploading a file we already had on disk.
    streamAnalysis(clipId)
  }

  function selectLap(lap: number) {
    const clip = timeline?.clips.find((c) => c.lap === lap)
    if (clip) setSelectedClipId(clip.clip_id)
  }

  const driverCard = getDriver(driver)
  const circuit = getCircuit(sessionId)
  const verdict = readVerdict(timeline)
  const loading = useHeldFlag(!timelineLoaded)

  // Every livery-coloured accent in the tree reads these instead of taking the
  // driver as a prop, so a new accent never needs threading through.
  const teamVars = {
    ['--team' as string]: driverCard.team.color,
    ['--team-ink' as string]: driverCard.team.ink,
  }

  const noClips = timeline != null && timeline.clips.length === 0 && uploaded == null

  // A clip uploaded without a lap number belongs to no lap, so every panel in the
  // left column describes a race it is not connected to. Leaving them at full
  // strength is the actual risk: a full timeline beside a freshly uploaded clip
  // reads as being *about* that clip. Dimming them is the honest signal, and it
  // beats blanking them — the session data is still real, it just isn't related.
  const detachedUpload =
    selectedClip != null &&
    selectedClip.clip_id.startsWith('upload-') &&
    selectedClip.lap == null

  // SignalBars is deliberately excluded from this: voice features are intrinsic
  // to the audio, so they are exactly as valid for a random clip off the internet
  // as for a curated one. Dimming it would disown the one panel that still holds.
  const unrelated = detachedUpload ? 'opacity-40 saturate-50' : ''

  return (
    <div className="relative z-10 min-h-full" style={teamVars}>
      <Header
        sessions={sessions}
        sessionId={sessionId}
        driver={driver}
        mode={mode}
        health={health}
        onSessionChange={setSessionId}
        onDriverChange={setDriver}
        onModeChange={setMode}
        currentSession={session}
        busy={loading}
      />

      <main className="mx-auto max-w-[1680px] space-y-4 px-4 py-4 sm:px-6 sm:py-5 lg:space-y-5">
        {error && (
          <div
            className="flex items-start gap-3 rounded-xl border px-4 py-3"
            style={{
              borderColor: 'color-mix(in srgb, var(--status-critical) 40%, transparent)',
              background: 'color-mix(in srgb, var(--status-critical) 9%, transparent)',
            }}
            role="alert"
          >
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-status-critical"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-status-critical">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="panel">
            <StartLights
              label={
                session ? `Loading ${session.event_name}` : 'Reaching the pit wall'
              }
              detail={
                session
                  ? `${driverCard.first} ${driverCard.last} · ${
                      mode === 'fusion' ? 'fusion scoring' : 'single-model scoring'
                    } · real FastF1 timing`
                  : 'Fetching cached race sessions'
              }
            />
          </div>
        ) : timeline == null || verdict == null ? (
          error ? null : (
            <div className="panel px-6 py-20 text-center text-sm text-ink-muted">
              No session selected.
            </div>
          )
        ) : (
          <>
            {/* Keyed on driver so the plate's entrance animation replays and the
                switch is visible, not just true. */}
            <ComponentErrorBoundary>
              <VerdictHero
                key={`${sessionId}-${driver}`}
                verdict={verdict}
                driver={driverCard}
                circuit={circuit}
                eventName={timeline.session.event_name}
                year={timeline.session.year}
                mode={mode}
                onSelectClip={setSelectedClipId}
              />
            </ComponentErrorBoundary>

            {noClips && (
              <div
                className="flex items-start gap-3 rounded-xl border px-4 py-3"
                style={{
                  borderColor: 'rgba(0,217,255,0.3)',
                  background: 'rgba(0,217,255,0.05)',
                }}
              >
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0 text-accent-cyan"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-accent-cyan">
                    Real lap data, no radio scored yet.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    The pace panel is genuine FastF1 timing for {timeline.session.event_name},{' '}
                    {timeline.driver}. Stress, strategy and correlation stay empty until a clip is
                    scored — pick one from the radio library, or upload your own.
                  </p>
                </div>
              </div>
            )}

            {/* 2-column layout: 65-70% evidence + 30-35% inspector sidebar.
                `items-start` so the sidebar's own height is its own business and it
                is not stretched to match the (much taller) evidence column. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,450px)]">
              {/* LEFT PANEL: Evidence charts, strategies, methodology. Scrolls with
                  the document — it is the tall column, so the page scrollbar is its
                  scrollbar and the 392px hero above is free to scroll away. */}
              <div className="min-w-0 space-y-4 lg:space-y-5">
                {/* Says out loud what the dimming below only implies. Sticky so it
                    stays with you down the column — the panels it disclaims are
                    4000px tall, and a banner that scrolls away stops disclaiming
                    them about one screen in. */}
                {detachedUpload && (
                  <div
                    className="sticky top-[88px] z-20 flex items-start gap-2.5 rounded-xl border px-4 py-2.5 backdrop-blur-xl"
                    style={{
                      borderColor: 'rgba(0,217,255,0.3)',
                      background: 'color-mix(in srgb, var(--plane) 85%, transparent)',
                    }}
                    role="status"
                  >
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-[12px] leading-relaxed text-ink-secondary">
                      Showing{' '}
                      <span className="text-ink">
                        {timeline.session.year} {timeline.session.event_name} · {timeline.driver}
                      </span>{' '}
                      — <span className="text-ink">not linked to the uploaded clip</span>. Add a lap
                      number to place it in the race. The voice breakdown below is still this
                      clip&rsquo;s own.
                    </p>
                  </div>
                )}

                <ComponentErrorBoundary>
                  <div className={unrelated}>
                    <RaceTimeline
                      timeline={timeline}
                      selectedClipId={selectedClipId}
                      onSelectClip={setSelectedClipId}
                      verdict={verdict}
                    />
                  </div>
                </ComponentErrorBoundary>

                {/* Where it happened, then what the track was doing — the two
                    readings that give the chart above its meaning. The trace is
                    wide because its whole value is spatial; conditions is narrow
                    because it is three numbers and a line. */}
                <div
                  className={`grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-5 ${unrelated}`}
                >
                  {circuit && (
                  <ComponentErrorBoundary>
                    <TrackTrace
                      circuit={circuit}
                      clips={timeline.clips}
                      contexts={timeline.clip_contexts}
                      mode={mode}
                      selectedClipId={selectedClipId}
                      onSelectClip={setSelectedClipId}
                    />
                  </ComponentErrorBoundary>
                  )}
                  {/* Conditions and tyres stack in the narrow column: the trace
                      is tall, and these two are what explain it — the track the
                      driver was on and the rubber they were on it with. */}
                  <div className="space-y-4 lg:space-y-5">
                    <ComponentErrorBoundary>
                      <TrackConditions
                        context={timeline.session_context}
                        selectedLap={selectedClip?.lap ?? null}
                        onSelectLap={selectLap}
                      />
                    </ComponentErrorBoundary>
                    <ComponentErrorBoundary>
                      <TyreStints
                        context={timeline.session_context}
                        driver={driver}
                        onSelectLap={selectLap}
                      />
                    </ComponentErrorBoundary>
                  </div>
                </div>

                {findingsAvailable && (
                  <ComponentErrorBoundary>
                    <div className={unrelated}>
                      <TopFindings
                        findings={findings}
                        loading={findingsLoading}
                        error={findingsError}
                        onSelectLap={selectLap}
                        onRefresh={() => setFindingsNonce((n) => n + 1)}
                      />
                    </div>
                  </ComponentErrorBoundary>
                )}

                <div className={`grid gap-4 md:grid-cols-2 lg:gap-5 ${unrelated}`}>
                  <ComponentErrorBoundary>
                    <StrategyCalls calls={timeline.strategy_calls} onSelectLap={selectLap} />
                  </ComponentErrorBoundary>
                  <ComponentErrorBoundary>
                    <LeadLagPanel analysis={timeline.lead_lag} />
                  </ComponentErrorBoundary>
                </div>

                {/* Dimmed with the rest: the baseline shown here is the picker
                    driver's, and an uploaded clip was scored against that driver
                    only because they happened to be selected — not because the
                    voice belongs to them. */}
                <div className={unrelated}>
                  <Baseline timeline={timeline} clip={selectedClip} mode={mode} />
                </div>

                {/* SignalBars and BiometricsPanel share this row but not this
                    judgement, so they are wrapped separately: the voice bars are
                    the clip's own, the biometrics are the session's. */}
                <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
                  {selectedClip ? (
                    <ComponentErrorBoundary>
                      <SignalBars clip={selectedClip} mode={mode} />
                    </ComponentErrorBoundary>
                  ) : (
                    <div />
                  )}
                  <ComponentErrorBoundary>
                    <div className={unrelated}>
                      <BiometricsPanel
                        sessionId={sessionId ?? ''}
                        driver={driver}
                        series={biometrics ?? timeline.biometrics}
                        onUploaded={setBiometrics}
                      />
                    </div>
                  </ComponentErrorBoundary>
                </div>
              </div>

              {/* RIGHT PANEL: Radio Inspector and Library.
                  This used to be `sticky top-[88px] h-fit`, which is exactly why it
                  felt stuck. `h-fit` let it grow past the viewport while `sticky`
                  pinned its top, so its lower half sat permanently below the fold
                  with no way to reach it: the only scrollbar on the page belonged to
                  the document, and spending that scrollbar ran the tall left column
                  to the bottom while this panel sat still.
                  Now it is capped to the visible area and owns its own scrollbar, so
                  the wheel acts on whichever panel the pointer is over.
                  `overscroll-contain` keeps a fling that reaches the end of this
                  panel from chaining into the page and re-coupling the two. */}
              <aside className="min-w-0 space-y-6 lg:sticky lg:top-[88px] lg:h-[calc(100vh-104px)] lg:space-y-6 lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5">
                <ComponentErrorBoundary>
                  <RadioInspector
                    clip={selectedClip}
                    mode={mode}
                    onUpload={handleUpload}
                    busy={busy}
                    uploadLap={uploadLap}
                    onUploadLapChange={setUploadLap}
                    progress={progress}
                    streaming={streamingClipId != null}
                    timeline={timeline}
                    onReanalyse={
                      selectedClipId && !selectedClipId.startsWith('upload-')
                        ? () => streamAnalysis(selectedClipId)
                        : undefined
                    }
                  />
                </ComponentErrorBoundary>

                {sessionId && (
                  <ComponentErrorBoundary>
                    {/* The old `maxHeight: 400px` wrapper set a cap with no
                        `overflow`, so it never scrolled — it just cropped the
                        panel's own footer. ClipBrowser already scrolls its list
                        internally; the sidebar scrolls the rest. */}
                    <div>
                      <ClipBrowser
                        sessionId={sessionId}
                        driver={driver}
                        selectedClipId={selectedClipId}
                        onSelect={handleBrowseSelect}
                        refreshKey={libraryVersion}
                        streamingClipId={streamingClipId}
                      />
                    </div>
                  </ComponentErrorBoundary>
                )}
              </aside>
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-[1680px] px-4 pb-24 pt-2" aria-hidden="true">
        {/* Footer removed per user request */}
      </footer>

      {/* Floating Ask the Pit Wall - restored as separate element */}
      <ComponentErrorBoundary>
        <PitWallChat sessionId={sessionId} driver={driver} />
      </ComponentErrorBoundary>
    </div>
  )
}

/**
 * What the stress score is measured against.
 *
 * Small, and last on the page, but it is the difference between "this driver
 * sounds loud" and "this driver sounds loud *for them*" — so it says which of
 * the three references is actually in play rather than implying the best case.
 */
function Baseline({
  timeline,
  clip,
  mode,
}: {
  timeline: Timeline
  clip: ClipAnalysis | null
  mode: ScoringMode
}) {
  const b = timeline.baseline
  const result = clip ? (mode === 'fusion' ? clip.fusion : clip.naive) : null

  return (
    <section className="panel p-4 sm:p-5" aria-label="Driver baseline">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
        <div className="lg:max-w-[46ch]">
          <h2 className="card-title">Scored against</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            {!b
              ? 'Population priors. No calm calls have been scored for this driver, so there is no personal reference to calibrate against yet.'
              : b.source === 'driver'
                ? `${b.driver}’s own calm calls, so a naturally loud driver doesn’t read as permanently stressed.`
                : b.source === 'cohort'
                  ? 'The pooled cohort — this driver has too few calm calls for an individual baseline yet.'
                  : 'Population priors, not this driver. No annotated calls exist yet, so nothing is individually calibrated.'}
          </p>
        </div>

        {b && (
          <div className="flex-1">
            <p className="mb-2 text-[10px] text-ink-muted">
              Each driver is compared to their own baseline — ensuring a naturally loud driver isn't flagged as constantly stressed
            </p>
            <dl
              className="grid gap-x-6 gap-y-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
            >
              {[
                ['Reference', b.source],
                ['Baseline clips', String(b.n_baseline_clips)],
                ['Mean pitch (z)', b.f0_mean.toFixed(2)],
                ['Mean energy (z)', b.rms_mean.toFixed(3)],
                ['Speech rate (z)', b.speech_rate.toFixed(2)],
              ].map(([k, v]) => (
                <div key={k} style={{ minWidth: '140px' }}>
                  <dt className="eyebrow" style={{ fontSize: 9 }}>
                    {k}
                  </dt>
                  <dd className="mono mt-1 text-[15px] text-ink-primary">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* The numbers above say what the reference is. This says where the call
          came out against it, which is the only thing anyone reads them for. */}
      <BaselineBand result={result} baseline={b} clip={clip} />
    </section>
  )
}

export default function App() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // In production, send to error tracking service (e.g. Sentry).
        console.error('App error:', error, errorInfo)
      }}
    >
      <AppContent />
    </ErrorBoundary>
  )
}
