/**
 * Frontend constants - centralized configuration
 * Avoids magic numbers scattered throughout components
 */

// UI Dimensions
export const UI = {
  // Chat dimensions
  CHAT_WIDTH: 400,
  CHAT_HEIGHT: 600,
  CHAT_BUTTON_SIZE: 64,
  CHAT_ICON_SIZE: 28,

  // Hit target sizes (accessibility)
  MIN_HIT_TARGET: 24, // 24px minimum for clickable elements
  CHART_DOT_HIT_TARGET: 24, // Invisible hit target for chart dots

  // Spacing
  HEADER_PADDING_Y: 12, // py-3
  CARD_PADDING: 16, // p-4
  SECTION_GAP: 16, // gap-4

  // Z-index layers
  Z_CHAT: 50,
  Z_MODAL: 40,
  Z_HEADER: 30,
  Z_OVERLAY: 20,

  // Animation durations (ms)
  TRANSITION_FAST: 150,
  TRANSITION_NORMAL: 200,
  TRANSITION_SLOW: 300,
  ANIMATION_PULSE: 2000,

  // Chart dimensions
  TIMELINE_HEIGHT_PACE: 150,
  TIMELINE_HEIGHT_STRESS: 176,
  TIMELINE_MARGIN: { top: 4, right: 12, bottom: 4, left: 4 },
} as const

// Color values (CSS custom properties)
export const COLORS = {
  // Brand colors
  BRAND: '#ff0050',
  ACCENT_CYAN: '#00d9ff',
  ACCENT_GREEN: '#00ff88',

  // Status colors
  STATUS_GOOD: '#00ff88',
  STATUS_WARNING: '#ffaa00',
  STATUS_SERIOUS: '#ff6b00',
  STATUS_CRITICAL: '#ff0050',

  // Surface colors
  PLANE: '#050505',
  SURFACE: '#0f0f0f',
  RAISED: '#1a1a1a',

  // Text colors
  TEXT_PRIMARY: '#ffffff',
  TEXT_SECONDARY: '#b8b8b8',
  TEXT_MUTED: '#6b6b6b',

  // Mood colors (matches types.ts MOOD_COLOR)
  MOOD_CALM: '#00ff88',
  MOOD_STRESSED: '#ff0050',
  MOOD_TIRED: '#ffaa00',
} as const

// Glassmorphism styles (reusable)
export const GLASS = {
  // Standard glass panel
  PANEL: {
    background: 'linear-gradient(145deg, rgba(15, 15, 15, 0.85) 0%, rgba(10, 10, 10, 0.9) 100%)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 0, 80, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
  },

  // Header glass
  HEADER: {
    background: 'linear-gradient(135deg, rgba(10, 10, 10, 0.95) 0%, rgba(20, 15, 15, 0.98) 50%, rgba(10, 10, 10, 0.95) 100%)',
    backdropFilter: 'blur(20px)',
  },

  // Light glass (controls)
  CONTROL: {
    background: 'rgba(26, 26, 26, 0.8)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },

  // Button ring
  BUTTON_RING: {
    background: 'linear-gradient(135deg, rgba(15, 15, 15, 0.9) 0%, rgba(20, 20, 20, 0.85) 100%)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
} as const

// Typography
export const TYPOGRAPHY = {
  // Font sizes
  SIZE_TINY: '9px',
  SIZE_XS: '10px',
  SIZE_SM: '11px',
  SIZE_BASE: '14px',
  SIZE_LG: '16px',
  SIZE_XL: '20px',

  // Line heights
  LEADING_TIGHT: 1.25,
  LEADING_SNUG: 1.375,
  LEADING_NORMAL: 1.5,
  LEADING_RELAXED: 1.625,

  // Letter spacing
  TRACKING_TIGHT: '-0.02em',
  TRACKING_NORMAL: '0',
  TRACKING_WIDE: '0.05em',
  TRACKING_WIDER: '0.1em',
  TRACKING_WIDEST: '0.15em',
} as const

// API Configuration
export const API = {
  // Request timeouts (ms)
  TIMEOUT_DEFAULT: 30000, // 30s
  TIMEOUT_AGENT: 60000, // 60s for agent (LLM calls take time)
  TIMEOUT_UPLOAD: 120000, // 2 minutes for audio upload

  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1s base delay

  // WebSocket
  WS_RECONNECT_DELAY: 3000, // 3s
  WS_MAX_RECONNECTS: 5,
} as const

// Chat Configuration
export const CHAT = {
  // Limits
  MAX_MESSAGE_LENGTH: 500,
  MAX_HISTORY: 50,
  TYPING_INDICATOR_DELAY: 300, // Show after 300ms

  // Suggested questions count
  SUGGESTED_QUESTIONS_COUNT: 5,

  // Auto-scroll behavior
  SCROLL_BEHAVIOR: 'smooth' as ScrollBehavior,
  SCROLL_DELAY: 100, // Delay before scrolling (let DOM update)
} as const

// Chart Configuration
export const CHART = {
  // Data display
  PACE_PERCENTILE_LOW: 0.02, // 2nd percentile for robust y-axis
  PACE_PERCENTILE_HIGH: 0.95, // 95th percentile
  PACE_PADDING_FACTOR: 0.15, // 15% padding around data

  // Axis defaults
  PACE_MIN_DOMAIN: -0.25,
  PACE_MAX_DOMAIN: 0.5,
  STRESS_MIN: 0,
  STRESS_MAX: 100,

  // Visual
  DOT_SIZE_DEFAULT: 5.5,
  DOT_SIZE_SELECTED: 7,
  STROKE_WIDTH: 2,
  GRID_OPACITY: 0.5,

  // Interaction
  SYNC_ID: 'race', // Syncs crosshairs between panels
} as const

// Validation
export const VALIDATION = {
  // Lap numbers
  LAP_MIN: 1,
  LAP_MAX: 99,

  // File upload
  AUDIO_MAX_SIZE_MB: 10,
  AUDIO_ACCEPTED_FORMATS: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'],
} as const

// Feature Flags (client-side)
export const FEATURES = {
  ENABLE_KEYBOARD_SHORTCUTS: true,
  ENABLE_ANALYTICS: false, // Set to true in production
  ENABLE_ERROR_REPORTING: false, // Set to true with Sentry
  ENABLE_PREFETCH: true, // Prefetch next session data
} as const

// Performance
export const PERF = {
  // Debounce delays (ms)
  DEBOUNCE_SEARCH: 300,
  DEBOUNCE_RESIZE: 150,

  // Throttle delays (ms)
  THROTTLE_SCROLL: 100,

  // Cache
  CACHE_TIMELINE_TTL: 5 * 60 * 1000, // 5 minutes
} as const
