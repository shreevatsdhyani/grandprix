import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * What a crash looks like.
 *
 * Both fallbacks are built from the theme tokens rather than literals, because a
 * crash is exactly when nobody is around to notice that the error screen only
 * reads in one theme.
 *
 * The two levels do different jobs. `ErrorBoundary` wraps the app and owns the
 * whole viewport: nothing is left to look at, so it says so and offers a reload.
 * `ComponentErrorBoundary` wraps one card and holds that card's footprint, so a
 * panel that fails leaves a labelled gap instead of collapsing the grid and
 * moving every other panel out from under the reader's cursor.
 */

interface Props {
  children: ReactNode
  /** A function form so a fallback can name the error it is standing in for. */
  fallback?: ReactNode | ((error: Error | null) => ReactNode)
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

/** The raw message, in the one place a reader can copy it from into a bug report. */
function ErrorDetail({ error }: { error: Error | null }) {
  return (
    <pre className="mono overflow-auto whitespace-pre-wrap break-words rounded-[5px] border border-line bg-glass px-3 py-[10px] text-[11px] font-normal leading-[1.5] text-t2">
      {error?.message || 'No message was attached to the error.'}
    </pre>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      if (fallback) {
        return typeof fallback === 'function' ? fallback(this.state.error) : fallback
      }

      return (
        <div className="grid min-h-screen place-items-center px-6 py-10">
          <div className="panel w-full max-w-[520px] p-7">
            <div className="h-[3px] w-6 bg-mag" />

            {/* Inline colour, not a utility: `.eyebrow` sets its own `color` and is
                declared after Tailwind's utilities, so a `text-*` class loses. */}
            <p className="eyebrow mt-[18px]" style={{ color: 'var(--mag)' }}>
              Session lost
            </p>
            <h1 className="display mt-[10px] text-[26px]">The dashboard stopped drawing</h1>
            <p className="mt-3 font-sans text-[13px] font-normal leading-[1.55] text-t2">
              The interface hit an error it could not recover from, so it stopped rather than show
              you numbers it is no longer sure of. Nothing on the server was lost — reloading
              rebuilds this view from the same analysed session.
            </p>

            <div className="mt-4">
              <ErrorDetail error={this.state.error} />
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn btn-primary notch mt-5"
            >
              Reload the dashboard
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * One panel's worth of failure.
 *
 * `label` names the panel so the copy points at something the reader can see on
 * the page, rather than at "a component".
 */
export function ComponentErrorBoundary({
  children,
  label = 'This panel',
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div className="panel flex min-h-[180px] flex-col justify-center p-5">
          <p className="eyebrow" style={{ color: 'var(--mag)' }}>
            Panel offline
          </p>
          <p className="mt-[10px] font-sans text-[13px] font-normal leading-[1.55] text-t2">
            {label} hit an error and could not draw; the rest of the dashboard is unaffected and
            still reading this session.
          </p>

          <div className="mt-3">
            <ErrorDetail error={error} />
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
