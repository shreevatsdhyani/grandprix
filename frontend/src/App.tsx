import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyseClip, analyseViaWebSocket, getHealth, getSessions, getTimeline } from './api'
import { ClipBrowser } from './components/ClipBrowser'
import { Header } from './components/Header'
import { LeadLagPanel } from './components/LeadLagPanel'
import { PitWallChat } from './components/PitWallChat'
import { RaceTimeline } from './components/RaceTimeline'
import { RadioInspector } from './components/RadioInspector'
import { SignalBars } from './components/SignalBars'
import { StrategyCalls } from './components/StrategyCalls'
import type {
  ClipAnalysis,
  HealthResponse,
  ProgressEvent,
  ScoringMode,
  SessionMeta,
  Timeline,
} from './types'

export default function App() {
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

  const noClips = timeline != null && timeline.clips.length === 0 && uploaded == null

  return (
    <div className="min-h-full bg-plane">
      {/* Professional Header */}
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
      />

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-status-critical/40 bg-status-critical/10 px-4 py-3 shadow-glow-red backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-status-critical/20 flex items-center justify-center">
                <svg className="h-5 w-5 text-status-critical" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-status-critical">{error}</p>
            </div>
          </div>
        )}

        {noClips && (
          <div className="mb-4 rounded-xl border border-accent-cyan/30 bg-accent-cyan/5 px-4 py-3 shadow-glow-cyan backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-accent-cyan/20 flex items-center justify-center">
                <svg className="h-5 w-5 text-accent-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent-cyan">Real lap data, no radio clips yet.</p>
                <p className="text-xs text-ink-muted mt-1">
                  The pace panel below is {timeline?.session.event_name}, {timeline?.driver} — real
                  FastF1 timing. Stress, strategy and correlation stay empty until clips are added to{' '}
                  <code className="rounded bg-raised px-1.5 py-0.5 text-ink-secondary">data/clips/</code>, or you upload one on the left.
                </p>
              </div>
            </div>
          </div>
        )}

        {!timelineLoaded ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="spinner mb-6" />
            <p className="text-sm font-medium text-ink-secondary">Loading session data...</p>
            <p className="text-xs text-ink-muted mt-1">Initializing AI models and race telemetry</p>
          </div>
        ) : error && !timeline ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="mb-6 h-16 w-16 rounded-full bg-status-critical/10 flex items-center justify-center">
              <svg className="h-8 w-8 text-status-critical" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-status-critical">{error}</p>
          </div>
        ) : timeline == null ? null : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr_340px]">
            {/* Left Column: Radio Inspector & Clip Browser */}
            <div className="flex flex-col gap-4">
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
                // Uploads are excluded: the stream route resolves clips through
                // the index, and an upload isn't in it.
                onReanalyse={
                  selectedClipId && !selectedClipId.startsWith('upload-')
                    ? () => streamAnalysis(selectedClipId)
                    : undefined
                }
              />
              <SignalBars clip={selectedClip} />
              {sessionId && (
                <ClipBrowser
                  sessionId={sessionId}
                  driver={driver}
                  selectedClipId={selectedClipId}
                  onSelect={handleBrowseSelect}
                  refreshKey={libraryVersion}
                />
              )}
            </div>

            {/* Center Column: Timeline & Lead-Lag Analysis */}
            <div className="flex flex-col gap-4">
              <RaceTimeline
                timeline={timeline}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
              />
              <LeadLagPanel analysis={timeline.lead_lag} />
            </div>

            {/* Right Column: Strategy Calls & Driver Baseline */}
            <div className="flex flex-col gap-4">
              <StrategyCalls calls={timeline.strategy_calls} onSelectLap={selectLap} />

              <section className="card p-4" aria-label="Driver baseline">
                <h2 className="card-title mb-2">Driver baseline</h2>
                {timeline.baseline ? (
                  <>
                    <p className="mb-2 text-[11px] leading-snug text-ink-muted">
                      {timeline.baseline.source === 'driver'
                        ? `Features are scored against ${timeline.baseline.driver}’s own calm calls, so a naturally loud driver doesn’t read as permanently stressed.`
                        : timeline.baseline.source === 'cohort'
                          ? 'Scored against the pooled cohort — this driver has too few calm clips for an individual baseline yet.'
                          : 'Population priors, not this driver. No annotated clips exist yet, so nothing is individually calibrated.'}
                    </p>
                    <dl className="space-y-1 text-[11px]">
                      {[
                        ['Reference', timeline.baseline.source],
                        ['Baseline clips', String(timeline.baseline.n_baseline_clips)],
                        ['Mean pitch (z)', timeline.baseline.f0_mean.toFixed(2)],
                        ['Mean energy (z)', timeline.baseline.rms_mean.toFixed(3)],
                        ['Speech rate (z)', timeline.baseline.speech_rate.toFixed(2)],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <dt className="text-ink-muted">{k}</dt>
                          <dd className="tabular text-ink-secondary">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p className="text-[11px] leading-snug text-ink-muted">
                    No calm clips analysed yet, so there is no reference to calibrate against.
                    Scoring currently uses population priors.
                  </p>
                )}
              </section>

              {selectedClip && !selectedClip.fusion.fitted && mode === 'fusion' && (
                <div className="rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <svg className="h-5 w-5 flex-shrink-0 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-status-warning">Fusion AI Using Fallback Mode</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">
                        The AI is using interpretable rules. For best accuracy, train the fusion model by running <code className="rounded bg-raised px-1.5 py-0.5 text-ink-secondary">scripts/fit_fusion.py</code> after labeling clips.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating chat - available everywhere once a session is selected */}
      <PitWallChat sessionId={sessionId} driver={driver} />
    </div>
  )
}
