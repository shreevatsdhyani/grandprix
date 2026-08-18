/** @type {import('tailwindcss').Config} */

// Every colour here resolves to a CSS variable defined in src/index.css, never to
// a literal. That is what makes the COCKPIT/PIT LANE toggle work: flipping
// `data-theme` on <html> re-points all of them at once, with no `dark:` variants
// anywhere in the markup and no second palette to keep in sync.
//
// Names match the design tokens deliberately (s1/s2/s3, t1/t2/t3, pap/cyan/mag)
// so markup reads the same as the spec it was drawn from.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        s1: 'var(--s1)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',

        line: 'var(--line)',
        line2: 'var(--line2)',

        t1: 'var(--t1)',
        t2: 'var(--t2)',
        t3: 'var(--t3)',

        pap: 'var(--pap)',
        pap2: 'var(--pap2)',
        yel: 'var(--yel)',
        cyan: 'var(--cyan)',
        mag: 'var(--mag)',
        pur: 'var(--pur)',
        grn: 'var(--grn)',

        glass: 'var(--glass)',
        grid: 'var(--grid)',

        // Readable text on top of papaya. Same value in both themes.
        ink: 'var(--ink)',

        // Livery colour of the driver on screen. Set on the root div in App.tsx.
        team: 'var(--team)',
        'team-ink': 'var(--team-ink)',
      },

      borderColor: {
        DEFAULT: 'var(--line)',
      },

      fontFamily: {
        // Prose only.
        sans: ['Barlow', 'system-ui', '-apple-system', 'sans-serif'],
        // Every heading, eyebrow, button and driver surname.
        cond: ['Barlow Condensed', 'Barlow', 'system-ui', 'sans-serif'],
        // Every number, lap reference and model id.
        mono: ['Roboto Mono', 'ui-monospace', 'SF Mono', 'monospace'],
      },

      boxShadow: {
        panel: 'var(--sh)',
      },

      // The mockup is a fixed 1440px canvas; this is its content width.
      maxWidth: {
        canvas: '1440px',
      },
    },
  },
  plugins: [],
}
