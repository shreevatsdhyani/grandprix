import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  analyseClip,
  analyseViaWebSocket,
  getHealth,
  getModelCard,
  getSessions,
  getTimeline,
} from './api'
import { BaselinePanel } from './components/BaselinePanel'
import { ClipBrowser } from './components/ClipBrowser'
import { ComponentErrorBoundary, ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { LeadLagPanel } from './components/LeadLagPanel'
import { PitWallChat } from './components/PitWallChat'
import { RaceTimeline } from './components/RaceTimeline'
import { RadioInspector } from './components/RadioInspector'
import { SessionBanner } from './components/SessionBanner'
import { SignalBreakdown } from './components/SignalBreakdown'
import { StrategyCalls } from './components/StrategyCalls'
import { VerdictHero } from './components/VerdictHero'
import { getCircuit } from './lib/circuits'
import { getDriver } from './lib/drivers'
import { tint } from './lib/mood'
import { readVerdict } from './lib/verdict'
import type {
  ClipAnalysis,
  HealthResponse,
  ModelCard,
  ProgressEvent,
  ScoringMode,
  SessionMeta,
  Timeline,
} from './types'

/**
 * Open on the strongest data on the machine, not the API's default.
 *
 * The backend defaults to 2024 Silverstone / HAM, which is seven scored clips —
 * one of the thinnest buckets of the nine cached races. Monaco 2023 / SAI has 28
 * and is the only pair that can clear the significance floor, so it is what the
 * first screen should be. Both fall back cleanly if the cache differs.
 */
const OPENING_SESSION = '2023-monaco-r'
const OPENING_DRIVER = 'SAI'

const THEME_KEY = 'gp-theme'

/**
 * Hold a transient state on screen for a minimum time.
 *
 * Cached sessions resolve in under 100ms, and a loader that appears and vanishes
 * inside two frames reads as a flicker, not as feedback. Switching driver is the
 * main interaction on this page, so it gets a beat long enough to register as
 * "that worked" — and the beat is the same length whether the answer came from
 * cache or from a cold read.
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
  const [driver, setDriver] = useState(OPENING_DRIVER)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [timelineLoaded, setTimelineLoaded] = useState(false)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [modelCard, setModelCard] = useState<ModelCard | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<ClipAnalysis | null>(null)
  const [uploadLap, setUploadLap] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Bumping this refetches the timeline. `get()` in api.ts has no retry, and a
     failed timeline leaves `timeline` null — which is the whole board replaced by
     a settled skeleton. Without a way back that state lasts until a reload, and
     one dropped request is enough to reach it. */
  const [attempt, setAttempt] = useState(0)

  // The pre-paint script in index.html has already applied the stored theme to
  // <html>, so reading it back is what keeps this state and the DOM in step —
  // initialising to 'dark' here would desync them for one render.
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const [sweeping, setSweeping] = useState(false)

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
    getModelCard().then(setModelCard)
    getSessions()
      .then((list) => {
        setSessions(list)
        setSessionId(
          (prev) =>
            prev ??
            list.find((s) => s.session_id === OPENING_SESSION)?.session_id ??
            list[0]?.session_id ??
            null,
        )
      })
      .catch((e: Error) => setError(`Could not load sessions: ${e.message}`))
  }, [])

  const session = sessions.find((s) => s.session_id === sessionId) ?? null

  // Keep the driver valid when the race changes — not every driver started every
  // race, and requesting a missing one 404s.
  useEffect(() => {
    if (session && !session.drivers.includes(driver)) {
      const fallback = [OPENING_DRIVER, 'HAM'].find((d) => session.drivers.includes(d))
      setDriver(fallback ?? session.drivers[0])
    }
  }, [session, driver])

  useEffect(() => {
    if (!sessionId) return
    /* The session's own driver list is the authority on what can be fetched.
       A race change lands one render before the effect above has swapped out a
       driver who never started it, and fetching in that gap 404s: DEV is on
       screen from Monaco 2023, the reader picks Monza 2024, and the board is
       replaced by the failure state and a retry button for one render before the
       corrected request arrives. Skipping the doomed fetch — rather than blanking
       first — leaves the previous race up until the real answer lands.

       `session` is null only while the session list itself is still loading, and
       the fetch is allowed through then: the default pair is known-good. */
    if (session && !session.drivers.includes(driver)) return
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
  }, [sessionId, session, driver, mode, attempt])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      // Private-mode Safari throws on write. The theme still applies for this
      // session; only the memory of it is lost, which is not worth crashing for.
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* no-op */
      }
      return next
    })
    setSweeping(true)
  }, [])

  useEffect(() => {
    if (!sweeping) return
    const id = setTimeout(() => setSweeping(false), 400)
    return () => clearTimeout(id)
  }, [sweeping])

  const selectedClip = useMemo(() => {
    if (uploaded && uploaded.clip_id === selectedClipId) return uploaded
    if (selectedClipId && analysed[selectedClipId]) return analysed[selectedClipId]
    return timeline?.clips.find((c) => c.clip_id === selectedClipId) ?? null
  }, [timeline, selectedClipId, uploaded, analysed])

  /* The stress track the charts actually draw, with any upload folded in.

     An upload is scored against this session and driver and carries the lap the
     reader typed, but it is not in the curated radio index — and the backend
     timeline enumerates that index, so no number of refetches will ever contain
     it. The lap field promises the stress track, and without this overlay that
     promise was simply untrue: the clip analysed, the card filled, and the chart
     below never acknowledged it.

     Deliberately only the chart and its click-through. The hero verdict, the
     lead-lag fit and the strategy calls are the backend's own reading of the
     indexed set, and folding one ad-hoc upload into their inputs here would let
     the headline quote a peak that the correlation printed beneath it never saw.

     The upload wins its lap outright when a curated clip already sits there: it
     is the clip the reader just chose and the one the inspector is showing, so a
     marker that selected something else would be the surprising outcome. A lap
     past the end of the race matches no point and is silently not drawn — the
     analysis is still on screen, and inventing a lap the driver never ran to
     hang it on would be worse. */
  const boardTimeline = useMemo(() => {
    if (!timeline || !uploaded || uploaded.lap == null) return timeline
    if (uploaded.session_id !== timeline.session.session_id) return timeline
    if (uploaded.driver.toUpperCase() !== timeline.driver.toUpperCase()) return timeline

    const result = mode === 'fusion' ? uploaded.fusion : uploaded.naive
    return {
      ...timeline,
      points: timeline.points.map((p) =>
        p.lap === uploaded.lap
          ? {
              ...p,
              stress_index: result.stress_index,
              mood: result.mood,
              clip_id: uploaded.clip_id,
            }
          : p,
      ),
    }
  }, [timeline, uploaded, mode])

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

    // Already analysed — from the timeline's cache or an earlier stream — so show
    // it instantly rather than paying ~13s to recompute the same answer.
    const known = timeline?.clips.some((c) => c.clip_id === clipId) || analysed[clipId] != null
    if (known) {
      closeSocket()
      setStreamingClipId(null)
      return
    }

    // Unanalysed: run it now and stream the stages. This is what makes all 853
    // curated clips reachable — the timeline only plots clips that already have a
    // cached analysis, so without this there is no way to create one from the UI
    // except by uploading a file already on disk.
    streamAnalysis(clipId)
  }

  function selectLap(lap: number) {
    const clip = timeline?.clips.find((c) => c.lap === lap)
    if (clip) setSelectedClipId(clip.clip_id)
  }

  // Year-aware: two of the cached seasons straddle the AlphaTauri→RB and
  // Alfa Romeo→Kick Sauber rebrands, so the team a driver is captioned with
  // depends on which race is on screen.
  const driverCard = getDriver(driver, session?.year)
  const circuit = getCircuit(sessionId)
  const verdict = readVerdict(timeline)
  const loading = useHeldFlag(!timelineLoaded)

  // Every livery-coloured accent in the tree reads these instead of taking the
  // driver as a prop, so a new accent never needs threading through.
  const teamVars = {
    ['--team' as string]: driverCard.team.color,
    ['--team-ink' as string]: driverCard.team.ink,
  }

  return (
    <div className="relative mx-auto max-w-canvas px-6 pb-24 pt-5" style={teamVars}>
      {/* A light sweeping across the canvas on a theme change, the way the pit
          lane reads under a car going past. It exists because both palettes are
          complete token sets: without it the switch is instantaneous and reads
          as a glitch rather than as a deliberate change of state. */}
      {sweeping && (
        <div className="pointer-events-none absolute inset-0 z-[80] overflow-hidden" aria-hidden>
          <div className="sweep" />
        </div>
      )}

      <Header
        sessions={sessions}
        sessionId={sessionId}
        currentSession={session}
        circuit={circuit}
        driver={driver}
        mode={mode}
        health={health}
        modelCard={modelCard}
        theme={theme}
        onSessionChange={setSessionId}
        onDriverChange={setDriver}
        onModeChange={setMode}
        onToggleTheme={toggleTheme}
      />

      <div className="mt-4">
        <SessionBanner session={session} circuit={circuit} mode={mode} modelCard={modelCard} />
      </div>

      {error && (
        <div
          className="mt-4 flex items-start gap-3 rounded-md border px-4 py-3"
          style={{
            borderColor: tint('var(--mag)', 40),
            background: tint('var(--mag)', 8),
          }}
          role="alert"
        >
          <span className="mt-px text-[11px] leading-[1.4] text-mag" aria-hidden>
            ▲
          </span>
          <div className="min-w-0">
            <p className="font-cond text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-mag">
              Request failed
            </p>
            <p className="mono mt-1.5 break-words text-[11.5px] leading-[1.5] text-t2">{error}</p>
          </div>
          {/* The only route out of a failed timeline. `ml-auto` keeps it on the
              far edge so it reads as the action on the alert, not as part of the
              message. */}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="ml-auto h-[32px] shrink-0 self-center rounded-[5px] border border-line2 bg-s2 px-3.5 font-cond text-[11px] font-semibold uppercase tracking-[0.2em] text-t1 transition-[border-color,color] duration-[160ms] hover:border-pap hover:text-pap"
          >
            Try again
          </button>
        </div>
      )}

      {loading || timeline == null || verdict == null ? (
        <BoardSkeleton
          label={
            session
              ? `Reading ${session.event_name} · ${driverCard.last || driver}`
              : 'Reaching the pit wall'
          }
          settled={!loading && timeline == null && error != null}
        />
      ) : (
        <>
          {/* Keyed on the pair so the plate's entrance and the KPI count-up
              replay — three of the four numbers come from the same fetch, so
              without motion a driver change looks identical whether the numbers
              moved or not. */}
          <ComponentErrorBoundary label="The finding">
            <VerdictHero
              key={`${sessionId}-${driver}`}
              verdict={verdict}
              driver={driverCard}
              circuit={circuit}
              resetKey={`${sessionId}-${driver}-${mode}`}
            />
          </ComponentErrorBoundary>

          {/* items-stretch, not items-start: how tall the sidebar comes out
              depends entirely on how much radio a driver has, and a driver with
              two clips left 266px of bare page beside a full evidence column.
              Stretched, the shorter column is handed the slack and the radio
              library spends it (see ClipBrowser) instead of the page wearing it. */}
          <div className="mt-4 grid grid-cols-1 items-stretch gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_400px]">
            <div className="flex min-w-0 flex-col gap-4">
              <ComponentErrorBoundary label="The evidence">
                <RaceTimeline
                  // `?? timeline` only to keep the non-null narrowing this branch
                  // already proved; the memo returns the same object when there
                  // is nothing to overlay.
                  timeline={boardTimeline ?? timeline}
                  verdict={verdict}
                  raceLaps={circuit?.laps ?? null}
                  selectedClipId={selectedClipId}
                  onSelectClip={setSelectedClipId}
                />
              </ComponentErrorBoundary>

              <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
                <ComponentErrorBoundary label="The strategy calls">
                  <StrategyCalls calls={timeline.strategy_calls} onSelectLap={selectLap} />
                </ComponentErrorBoundary>
                <ComponentErrorBoundary label="The lead-lag test">
                  <LeadLagPanel analysis={timeline.lead_lag} nClips={timeline.clips.length} />
                </ComponentErrorBoundary>
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <ComponentErrorBoundary label="The radio call">
                <RadioInspector
                  clip={selectedClip}
                  mode={mode}
                  onUpload={handleUpload}
                  busy={busy}
                  uploadLap={uploadLap}
                  onUploadLapChange={setUploadLap}
                  progress={progress}
                  streaming={streamingClipId != null}
                  onReanalyse={
                    selectedClipId && !selectedClipId.startsWith('upload-')
                      ? () => streamAnalysis(selectedClipId)
                      : undefined
                  }
                />
              </ComponentErrorBoundary>

              {sessionId && (
                <ComponentErrorBoundary label="The radio library">
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

          {/* Method, last. Both cards answer "why should I believe the number
              above" — what it was measured against, and which branch produced
              it — so they read after the finding rather than competing with it. */}
          <div className="mt-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
            <ComponentErrorBoundary label="The baseline">
              <BaselinePanel baseline={timeline.baseline} driver={driverCard} />
            </ComponentErrorBoundary>
            <ComponentErrorBoundary label="The signal breakdown">
              <SignalBreakdown clip={selectedClip} mode={mode} />
            </ComponentErrorBoundary>
          </div>
        </>
      )}

      <ComponentErrorBoundary label="Ask the pit wall">
        <PitWallChat sessionId={sessionId} driver={driver} />
      </ComponentErrorBoundary>
    </div>
  )
}

/**
 * The page's shape while the timeline is in flight.
 *
 * Deliberately the same rhythm as the real board — hero, wide panel, two-up —
 * because the alternative is a spinner over a blank canvas, and then the layout
 * arrives all at once and everything jumps. This holds the space that is about
 * to be filled.
 *
 * `settled` marks the case where loading finished and nothing came back: the
 * skeleton stops pulsing, because a pulse promises data that is no longer coming.
 */
function BoardSkeleton({ label, settled }: { label: string; settled: boolean }) {
  const pulse = settled ? '' : 'anim-pulse'

  return (
    <div aria-busy={!settled} aria-live="polite">
      <section className="panel mt-4 overflow-hidden">
        <div className="grid grid-cols-1 gap-8 p-6 md:grid-cols-[336px_1fr]">
          <div className={`${pulse} h-[172px] rounded-lg border border-line bg-s2`} />
          <div className="flex flex-col gap-3.5">
            <p className="flex items-center gap-2.5">
              <span className="h-[2px] w-[18px] flex-none bg-pap" aria-hidden />
              <span className="font-cond text-[9.5px] font-semibold uppercase leading-none tracking-[0.22em] text-t3">
                {label}
              </span>
            </p>
            <div className={`${pulse} h-[46px] max-w-[620px] rounded bg-s2`} />
            <div className={`${pulse} h-[46px] max-w-[420px] rounded bg-s2`} />
            <div className={`${pulse} h-[22px] max-w-[520px] rounded bg-s2`} />
          </div>
        </div>

        <div
          className="grid grid-cols-2 gap-px border-t border-line lg:grid-cols-4"
          style={{ background: 'var(--line)' }}
        >
          {['Warning time', 'Peak stress', 'Strategy calls', 'Correlation'].map((k) => (
            <div key={k} className="bg-s2 px-6 py-[18px]">
              <span className="absolute left-0 top-0 h-[2px] w-[38px] bg-line2" aria-hidden />
              <p className="eyebrow">{k}</p>
              <p className="readout mb-2 mt-[10px] text-[40px] text-t3">—</p>
              <div className={`${pulse} h-[14px] max-w-[140px] rounded bg-s3`} />
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          <div className={`${pulse} panel h-[430px]`} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className={`${pulse} panel h-[240px]`} />
            <div className={`${pulse} panel h-[240px]`} />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className={`${pulse} panel h-[430px]`} />
          <div className={`${pulse} panel h-[240px]`} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error('App error:', error, errorInfo)
      }}
    >
      <AppContent />
    </ErrorBoundary>
  )
}
