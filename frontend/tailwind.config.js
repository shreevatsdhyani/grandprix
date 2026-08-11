/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces — near-black F1 pit-wall feel. Validated as the chart
        // surface for every palette in src/index.css.
        plane: '#0a0a08',
        surface: '#12120f',
        raised: '#1a1a17',
        hairline: '#26261f',

        ink: {
          primary: '#ffffff',
          secondary: '#c3c2b7',
          muted: '#898781',
        },

        // Categorical series slots 1–3. Validated all-pairs against #12120f:
        // worst CVD ΔE 9.4, worst normal-vision ΔE 20.9, all ≥3:1 contrast.
        series: {
          1: '#3987e5', // pace delta
          2: '#d95926', // stress index
          3: '#199e70', // text signal
        },

        // Status = state, never identity. Red/green fail CVD separation
        // (ΔE 4.1 deutan), so these NEVER carry meaning alone — every use is
        // paired with a text label and, on chart marks, a distinct shape.
        status: {
          good: '#0ca30c',
          warning: '#fab219',
          serious: '#ec835a',
          critical: '#d03b3b',
        },

        // Brand red is chrome only — wordmark, rules, accents. Deliberately
        // never used as a series or status color so it cannot impersonate data.
        brand: '#e10600',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
