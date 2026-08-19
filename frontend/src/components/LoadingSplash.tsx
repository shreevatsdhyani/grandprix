/**
 * Premium loading splash screen for initial app load.
 *
 * Shows F1-themed loading animation while models initialize.
 */

export function LoadingSplash() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-plane">
      {/* Animated background */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-brand/20 blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-accent-cyan/20 blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
      </div>

      {/* Content */}
      <div className="relative text-center">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className="h-16 w-2 rounded-full bg-racing-gradient shadow-glow-red" />
          <h1 className="text-4xl font-black uppercase tracking-wider">
            <span className="bg-racing-gradient bg-clip-text text-transparent">
              The Silent Co-Driver
            </span>
          </h1>
        </div>

        {/* Subtitle */}
        <p className="mb-8 text-sm font-semibold uppercase tracking-widest text-ink-muted">
          AI-Powered Race Strategy System
        </p>

        {/* Spinner */}
        <div className="mb-6 flex justify-center">
          <div className="spinner" />
        </div>

        {/* Status */}
        <p className="text-xs text-ink-muted">Initializing AI models and race telemetry...</p>
      </div>
    </div>
  )
}
