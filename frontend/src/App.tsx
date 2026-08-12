import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyseClip, analyseViaWebSocket, getHealth, getSessions, getTimeline } from './api'
import { ClipBrowser } from './components/ClipBrowser'
import { LeadLagPanel } from './components/LeadLagPanel'
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
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="h-4 w-1 rounded-sm bg-brand" aria-hidden />
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-ink-primary">
              The Silent Co-Driver
            </h1>
          </div>

          {/* One filter row above everything it scopes — never per-card. */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={sessionId ?? ''}
              onChange={(e) => setSessionId(e.target.value)}
              aria-label="Race"
              className="rounded border border-hairline bg-raised px-2 py-1.5 text-[11px] text-ink-secondary"
            >
              {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.year} {s.event_name}
                </option>
              ))}
            </select>

            <select
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              aria-label="Driver"
              className="rounded border border-hairline bg-raised px-2 py-1.5 text-[11px] text-ink-secondary"
            >
              {(session?.drivers ?? [driver]).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <div
              className="flex overflow-hidden rounded border border-hairline text-[11px]"
              role="group"
              aria-label="Scoring mode"
            >
              {(['naive', 'fusion'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`px-3 py-1.5 font-semibold uppercase tracking-wider transition ${
                    mode === m
                      ? 'bg-brand/20 text-ink-primary'
                      : 'text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {m === 'naive' ? 'Single model' : 'Fusion (ours)'}
                </button>
              ))}
            </div>

            {health && (
              <span
                className="flex items-center gap-1.5 text-[10px] text-ink-muted"
                title={Object.entries(health.models_loaded)
                  .map(([m, ok]) => `${ok ? '✓' : '✗'} ${m}`)
                  .join('\n')}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: health.offline_ready
                      ? 'var(--status-good)'
                      : 'var(--status-warning)',
                  }}
                  aria-hidden
                />
                {health.offline_ready ? 'Offline ready' : 'Degraded'}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-4">
        {error && (
          <div className="mb-3 rounded border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-xs text-ink-secondary">
            {error}
          </div>
        )}

        {noClips && (
          <div className="mb-3 rounded border border-hairline bg-raised px-3 py-2 text-xs text-ink-secondary">
            <strong className="text-ink-primary">Real lap data, no radio clips yet.</strong>{' '}
            The pace panel below is {timeline?.session.event_name}, {timeline?.driver} — real
            FastF1 timing. Stress, strategy and correlation stay empty until clips are added to{' '}
            <code className="text-ink-muted">data/clips/</code>, or you upload one on the left.
          </div>
        )}

        {!timelineLoaded ? (
          <div className="py-24 text-center text-sm text-ink-muted">Loading session…</div>
        ) : error && !timeline ? (
          <div className="py-24 text-center text-sm text-status-critical">
            {error}
          </div>
        ) : timeline == null ? null : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[340px_1fr_300px]">
            <div className="flex flex-col gap-3">
              <RadioInspector
                clip={selectedClip}
                mode={mode}
                onUpload={handleUpload}
                busy={busy}
                uploadLap={uploadLap}
                onUploadLapChange={setUploadLap}
                progress={progress}
                streaming={streamingClipId != null}
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

            <div className="flex flex-col gap-3">
              <RaceTimeline
                timeline={timeline}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
              />
              <LeadLagPanel analysis={timeline.lead_lag} />
            </div>

            <div className="flex flex-col gap-3">
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
                <p className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[10px] leading-snug text-ink-secondary">
                  <span aria-hidden>▲ </span>
                  Fusion head not trained yet — this verdict comes from the interpretable
                  fallback rule. Run <code>scripts/fit_fusion.py</code> once clips are labelled.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
