import type {
  BiometricSeries,
  ClipAnalysis,
  ClipSummary,
  FindingsResponse,
  HealthResponse,
  ProgressEvent,
  ScoringMode,
  SessionMeta,
  Timeline,
} from './types'

/** Relative base: Vite proxies /api in dev, same-origin in the Space build. */
const BASE = '/api'

/** Thrown with the status attached so callers can treat 404/503 as "feature off". */
export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: tsconfig sets `erasableSyntaxOnly`, which forbids that shorthand.
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText} — ${path}`, res.status)
  return res.json() as Promise<T>
}

/** Like `get`, but surfaces the backend's `{detail}` message when there is one. */
async function getWithDetail<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status)
  }
  return res.json() as Promise<T>
}

export const getHealth = () => get<HealthResponse>('/health')

export const getLibrary = (sessionId: string, driver: string) =>
  get<ClipSummary[]>(`/clips/library?session_id=${sessionId}&driver=${driver}`)

export const getSessions = () => get<SessionMeta[]>('/sessions')

export const getTimeline = (sessionId: string, driver: string, mode: ScoringMode) =>
  get<Timeline>(`/timeline/${sessionId}?driver=${driver}&mode=${mode}`)

/**
 * LLM-authored top findings.
 *
 * 404 means the agent layer is off (GP_AGENT != 1) and the panel should hide
 * itself, the same convention PitWallChat already uses. 503 means the layer is on
 * but generation is unavailable — a missing key, a retired model, a rate limit —
 * and that distinction is worth showing the user rather than flattening to
 * "something went wrong".
 */
export const getFindings = (
  sessionId: string,
  driver: string,
  mode: ScoringMode,
  opts?: { refresh?: boolean },
) =>
  getWithDetail<FindingsResponse>(
    `/findings/${sessionId}?driver=${driver}&mode=${mode}${opts?.refresh ? '&refresh=true' : ''}`,
  )

/** 404 here means no biometrics uploaded, which is the normal case. */
export const getBiometrics = (sessionId: string, driver: string) =>
  getWithDetail<BiometricSeries>(`/biometrics/${sessionId}?driver=${driver}`)

export async function uploadBiometrics(
  file: File,
  sessionId: string,
  driver: string,
): Promise<BiometricSeries> {
  const form = new FormData()
  form.append('file', file)
  form.append('session_id', sessionId)
  form.append('driver', driver)

  const res = await fetch(`${BASE}/biometrics`, { method: 'POST', body: form })
  if (!res.ok) {
    // The parser's messages name the exact problem with the file, so they are
    // worth showing verbatim.
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status)
  }
  return res.json() as Promise<BiometricSeries>
}

export async function analyseClip(
  file: File,
  driver: string,
  sessionId: string,
  lap?: number,
): Promise<ClipAnalysis> {
  // Multipart form fields, matching the Form(...) params on the route.
  const form = new FormData()
  form.append('file', file)
  form.append('driver', driver)
  form.append('session_id', sessionId)
  if (lap != null) form.append('lap', String(lap))

  const res = await fetch(`${BASE}/analyse`, { method: 'POST', body: form })
  if (!res.ok) {
    // The backend returns {detail: "..."} on error; surface it rather than a
    // bare status code, because these messages are actionable.
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<ClipAnalysis>
}

/**
 * Re-analyse an already-indexed clip, streaming stage progress.
 *
 * This is the "prove it's live" path: a judge watches STT and the three signal
 * branches tick past in real time, which a fixture replay cannot fake. The REST
 * `analyseClip` above is kept as-is — this is strictly additive.
 *
 * Takes a `clip_id`, NOT a File: the backend route re-runs the pipeline over a
 * clip already on disk (it looks the id up via the clip index and refuses
 * anything it cannot find). Uploads keep using the REST path.
 *
 * Relative URL derived from `location`, so this works unchanged against the dev
 * server, `vite preview` and a tunnel — all three proxy /api with ws:true. A
 * hardcoded localhost:8000 would break every case except one.
 */
export function analyseViaWebSocket(
  clipId: string,
  handlers: {
    onProgress: (event: ProgressEvent) => void
    onResult: (result: ClipAnalysis) => void
    onError: (message: string) => void
  },
): WebSocket {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${scheme}//${location.host}${BASE}/analyse/ws`)

  // Set once a terminal message (done/error) has been handled, so the close
  // handler below can tell "server finished" from "socket dropped mid-analysis".
  let settled = false

  ws.onopen = () => ws.send(JSON.stringify({ clip_id: clipId }))

  ws.onmessage = (e) => {
    let msg: ProgressEvent & { result?: ClipAnalysis }
    try {
      msg = JSON.parse(e.data)
    } catch {
      handlers.onError('Malformed progress message from server')
      return
    }

    if (msg.stage === 'error') {
      settled = true
      handlers.onError(msg.message || 'Analysis failed')
      ws.close()
      return
    }

    // The final message carries stage:"done" AND the full ClipAnalysis, so the
    // result check must come before the generic progress path.
    if (msg.stage === 'done' && msg.result) {
      settled = true
      handlers.onProgress(msg)
      handlers.onResult(msg.result)
      ws.close()
      return
    }

    handlers.onProgress(msg)
  }

  // A failed handshake fires error then close; guard so the user sees one
  // message, not two.
  ws.onerror = () => {
    if (settled) return
    settled = true
    handlers.onError('Could not reach the analysis stream — is the backend running?')
  }

  ws.onclose = () => {
    if (settled) return
    settled = true
    handlers.onError('Analysis stream closed before finishing')
  }

  return ws
}
