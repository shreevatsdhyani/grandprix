import type { ClipAnalysis, ClipSummary, HealthResponse, ScoringMode, SessionMeta, Timeline } from './types'

/** Relative base: Vite proxies /api in dev, same-origin in the Space build. */
const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return res.json() as Promise<T>
}

export const getHealth = () => get<HealthResponse>('/health')

export const getLibrary = (sessionId: string, driver: string) =>
  get<ClipSummary[]>(`/clips/library?session_id=${sessionId}&driver=${driver}`)

export const getSessions = () => get<SessionMeta[]>('/sessions')

export const getTimeline = (sessionId: string, driver: string, mode: ScoringMode) =>
  get<Timeline>(`/timeline/${sessionId}?driver=${driver}&mode=${mode}`)

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
