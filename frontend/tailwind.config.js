/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces. Names are kept from the first build so existing markup keeps
        // resolving; the values moved to the blue-black carbon in index.css.
        plane: '#07080b',
        surface: '#0e1015',
        raised: '#161a21',
        hairline: '#232833',
        'hairline-bright': '#38404f',

        ink: {
          primary: '#eef2f8',
          secondary: '#98a2b3',
          muted: '#626c7c',
        },

        // Data series — unchanged hues, they are load-bearing across the charts.
        series: {
          1: '#00d9ff', // pace delta
          2: '#ff0050', // stress index
          3: '#00ff88', // transcript signal
        },

        status: {
          good: '#00ff88',      // Green = calm/good
          warning: '#ffaa00',   // Amber/orange = stressed
          serious: '#ff6b00',   // Orange = serious warning
          critical: '#ff0050',  // Red = critical ONLY
        },

        // Brand color changed from red to cyan (red reserved for critical states)
        brand: '#00d9ff', // Racing cyan (neutral, not alarming)
        accent: {
          cyan: '#00E5FF',      // Brighter cyan for pace/neutral data
          purple: '#b000ff',
          green: '#00ff88',     // Green for calm/good states
          amber: '#ffaa00',     // Amber for stressed states
        },

        // Livery colour of the driver currently on screen, set from JS.
        team: 'var(--team)',
      },
      fontFamily: {
        sans: ['InterVar', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
        // Racing-style condensed fonts for headlines, driver names, section titles
        racing: ['Titillium Web', 'Barlow Condensed', 'system-ui', 'sans-serif'],
        condensed: ['Barlow Condensed', 'Titillium Web', 'system-ui', 'sans-serif'],
        // Tabular monospace for timing-tower style numbers
        mono: ['JetBrainsMonoVar', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-red': '0 0 24px rgba(255, 0, 80, 0.35)',
        'glow-cyan': '0 0 24px rgba(0, 217, 255, 0.35)',
        'glow-green': '0 0 24px rgba(0, 255, 136, 0.35)',
        'glow-team': '0 0 26px color-mix(in srgb, var(--team) 45%, transparent)',
        bevel: '0 1px 0 rgba(255,255,255,0.06) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'racing-gradient': 'linear-gradient(135deg, #e6002b 0%, #00d9ff 100%)',
        'racing-gradient-vertical': 'linear-gradient(180deg, #e6002b 0%, #00d9ff 100%)',
      },
      animation: {
        'pulse-slow': 'gp-pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'gp-spin 3s linear infinite',
      },
    },
  },
  plugins: [],
}
