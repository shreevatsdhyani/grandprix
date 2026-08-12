import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces, not just loopback. Vite defaults to localhost, which
    // is unreachable from outside a dev container or VM — the port forward has
    // nothing to attach to. Also needed to demo from a phone on the same wifi.
    host: true,
    strictPort: true, // fail loudly instead of silently drifting to 5174

    // Cloud dev environments (Ona/Gitpod, Codespaces) serve the dev server from
    // a generated hostname. Vite rejects unknown Host headers by default, so
    // those hosts must be allowed explicitly or every request 403s.
    allowedHosts: ['.flexdev.roche.com', '.gitpod.dev', '.app.github.dev', 'localhost'],

    // Behind an HTTPS proxy (Ona/Gitpod/Codespaces) the page is served on 443
    // while Vite listens on 5173, so the HMR socket must be told where to
    // reconnect or hot reload silently dies. Opt-in, because hardcoding it
    // breaks HMR for anyone opening plain http://localhost:5173.
    //   GP_PUBLIC_HTTPS=1 npm run dev
    hmr: process.env.GP_PUBLIC_HTTPS === '1' ? { clientPort: 443, protocol: 'wss' } : undefined,
    // Proxy keeps the frontend origin-agnostic: same code works against a local
    // uvicorn, a tunnel, or the HF Space without rebuilding.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
  // `vite preview` serves the production build. Without this the proxy that
  // dev mode uses to reach the backend is absent, so every /api call 404s.
  // Also add port 4173 to CORS_ORIGINS in config.py — this is the other half
  // of the fix (already done).
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
})
