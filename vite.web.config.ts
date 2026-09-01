/**
 * The web build.
 *
 * Separate from `electron.vite.config.ts` because it produces something quite
 * different: one static bundle, no main process and no preload. What it shares
 * is the renderer — the same React source, built against a `window.api` that is
 * fulfilled in the tab rather than over IPC.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const root = __dirname
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve(root, 'src/web'),
  // Relative, so the bundle works both at a domain root and under a GitHub
  // Pages project path like /Better/. Absolute /assets URLs 404 in the latter.
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@': resolve(root, 'src/renderer/src')
    }
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
  },
  build: {
    outDir: resolve(root, 'out/web'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'src/web/index.html') }
  },
  server: {
    port: 5174,
    // Keeps development same-origin as well, so no CORS anywhere and no
    // separate configuration for the dev build.
    proxy: Object.fromEntries(
      ['/health', '/auth', '/me', '/changes'].map((path) => [
        path,
        { target: 'http://localhost:8787', changeOrigin: true }
      ])
    )
  },
  // sql.js reaches for these Node built-ins behind a feature check that a
  // bundler cannot see through; stubbing them keeps the check falsy.
  optimizeDeps: { exclude: ['sql.js'] }
})
