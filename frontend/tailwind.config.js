/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Premium F1 Pit Wall surfaces - Carbon fiber & titanium
        plane: '#050505',
        surface: '#0f0f0f',
        raised: '#1a1a1a',
        hairline: '#2a2a2a',

        ink: {
          primary: '#ffffff',
          secondary: '#b8b8b8',
          muted: '#6b6b6b',
        },

        // Racing series colors - High energy, high contrast
        series: {
          1: '#00d9ff', // Cyan - Pace delta
          2: '#ff0050', // Racing red - Stress
          3: '#00ff88', // Neon green - Performance
        },

        // Status colors - Mission critical indicators
        status: {
          good: '#00ff88',
          warning: '#ffaa00',
          serious: '#ff6b00',
          critical: '#ff0050',
        },

        // Brand colors - Racing identity
        brand: '#ff0050',
        accent: {
          cyan: '#00d9ff',
          purple: '#b000ff',
          green: '#00ff88',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'monospace',
        ],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      boxShadow: {
        'glow-red': '0 0 24px rgba(255, 0, 80, 0.4)',
        'glow-cyan': '0 0 24px rgba(0, 217, 255, 0.4)',
        'glow-green': '0 0 24px rgba(0, 255, 136, 0.4)',
      },
      backgroundImage: {
        'racing-gradient': 'linear-gradient(135deg, #ff0050 0%, #00d9ff 100%)',
        'racing-gradient-vertical': 'linear-gradient(180deg, #ff0050 0%, #00d9ff 100%)',
      },
    },
  },
  plugins: [],
}
