import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyseClip, analyseViaWebSocket, getHealth, getSessions, getTimeline } from './api'
import { ClipBrowser } from './components/ClipBrowser'
import { ComponentErrorBoundary, ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { LeadLagPanel } from './components/LeadLagPanel'
import { PitWallChat } from './components/PitWallChat'
import { RaceTimeline } from './components/RaceTimeline'
import { RadioInspector } from './components/RadioInspector'
import { SignalBars } from './components/SignalBars'
import { StartLights } from './components/StartLights'
import { StrategyCalls } from './components/StrategyCalls'
import { VerdictHero } from './components/VerdictHero'
import { getCircuit } from './lib/circuits'
import { getDriver } from './lib/drivers'
import { readVerdict } from './lib/verdict'
import type {
  ClipAnalysis,
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

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,390px)] lg:gap-5">
              {/* Analysis: what the session shows. */}
              <div className="min-w-0 space-y-4 lg:space-y-5">
                <ComponentErrorBoundary>
                  <RaceTimeline
                    timeline={timeline}
                    selectedClipId={selectedClipId}
                    onSelectClip={setSelectedClipId}
                    verdict={verdict}
                  />
                </ComponentErrorBoundary>

                <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
                  <ComponentErrorBoundary>
                    <StrategyCalls calls={timeline.strategy_calls} onSelectLap={selectLap} />
                  </ComponentErrorBoundary>
                  <ComponentErrorBoundary>
                    <LeadLagPanel analysis={timeline.lead_lag} />
                  </ComponentErrorBoundary>
                </div>

                {/* Full width and last: it is a footnote to everything above,
                    and putting it here is what stops the two columns ending
                    half a screen apart at desktop widths. */}
                <Baseline timeline={timeline} />
              </div>

              {/* Detail: the single call currently open, and why it scored. */}
              <aside className="min-w-0 space-y-4 lg:space-y-5">
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
                    // Uploads are excluded: the stream route resolves clips
                    // through the index, and an upload isn't in it.
                    onReanalyse={
                      selectedClipId && !selectedClipId.startsWith('upload-')
                        ? () => streamAnalysis(selectedClipId)
                        : undefined
                    }
                  />
                </ComponentErrorBoundary>

                <ComponentErrorBoundary>
                  <SignalBars clip={selectedClip} mode={mode} />
                </ComponentErrorBoundary>

                {sessionId && (
                  <ComponentErrorBoundary>
                    <ClipBrowser
                      sessionId={sessionId}
                      driver={driver}
                      selectedClipId={selectedClipId}
                      onSelect={handleBrowseSelect}
                      refreshKey={libraryVersion}
                      streamingClipId={streamingClipId}
                    />
                  </ComponentErrorBoundary>
                )}
              </aside>
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-[1680px] px-4 pb-24 pt-2 text-[10px] leading-relaxed text-ink-muted sm:px-6">
        Lap timing and circuit geometry from FastF1, cached on disk. Driver portraits are
        freely-licensed photographs from Wikimedia Commons — see{' '}
        <span className="mono">public/drivers/CREDITS.md</span>. No official Formula 1 or team
        imagery is used.
      </footer>

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
function Baseline({ timeline }: { timeline: Timeline }) {
  const b = timeline.baseline

  return (
    <section
      className="panel flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-8"
      aria-label="Driver baseline"
    >
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
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ['Reference', b.source],
            ['Baseline clips', String(b.n_baseline_clips)],
            ['Mean pitch (z)', b.f0_mean.toFixed(2)],
            ['Mean energy (z)', b.rms_mean.toFixed(3)],
            ['Speech rate (z)', b.speech_rate.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow" style={{ fontSize: 9 }}>
                {k}
              </dt>
              <dd className="mono mt-1 text-[15px] text-ink-primary">{v}</dd>
            </div>
          ))}
        </dl>
      )}
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
