import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { createApi } from './server/api.ts'
import { readServerEnv } from './server/env.ts'
import { BRANDS, brandKey } from './src/brand/profiles.ts'

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
      api.startBackgroundJobs()
      server.middlewares.use((req, res, next) => void api(req, res, next))
    },
    configurePreviewServer(server) {
      api.startBackgroundJobs()
      server.middlewares.use((req, res, next) => void api(req, res, next))
    },
  }
}

// White label (VITE_BRAND, src/brand): the page title, favicon and the data-brand attribute the brand's colours hang
// off. Tecstellar's build (no VITE_BRAND) leaves index.html exactly as written.
function brandHtml(): Plugin {
  let key: ReturnType<typeof brandKey> = 'tecstellar'
  return {
    name: 'tcc-brand',
    configResolved(config) {
      key = brandKey({ ...loadEnv(config.mode, config.root, ''), ...process.env }.VITE_BRAND)
    },
    transformIndexHtml(html) {
      if (key === 'tecstellar') return html
      return html
        .replace('<html lang="en">', `<html lang="en" data-brand="${key}">`)
        .replace(/<title>.*<\/title>/, `<title>${BRANDS[key].title}</title>`)
        .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />', `<link rel="icon" type="image/png" href="/brand/${key}-favicon.png" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), tccApi(), brandHtml()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Hosted (Railway) serves the built app with `vite preview`; its public hostname must be accepted.
  preview: { host: true, allowedHosts: true },
})
