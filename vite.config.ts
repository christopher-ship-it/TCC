import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createApi } from './server/api.ts'
import { readServerEnv } from './server/env.ts'

// Serves /api (recordings, call analysis — see server/api.ts) from the dev and preview servers, so the
// TeleCMI App Secret and the Gemini key stay on this machine instead of in the browser bundle.
function tccApi(): Plugin {
  let api: ReturnType<typeof createApi>
  return {
    name: 'tcc-api',
    configResolved(config) {
      const vars = { ...loadEnv(config.mode, config.root, ''), ...process.env }
      api = createApi(readServerEnv(vars, config.root))
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => void api(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void api(req, res, next))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tccApi()],
  // Hosted (Railway) serves the built app with `vite preview`; its public hostname must be accepted.
  preview: { host: true, allowedHosts: true },
})
