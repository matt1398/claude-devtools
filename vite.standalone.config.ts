/**
 * Vite build config for the standalone (non-Electron) server.
 *
 * Produces a single CJS bundle at dist-standalone/index.cjs that can be
 * run with `node dist-standalone/index.cjs`.
 */

import { resolve } from 'path'
import { defineConfig } from 'vite'

import type { Plugin } from 'vite'

// Node.js built-in modules that should be externalized
const nodeBuiltins = new Set([
  'fs', 'path', 'os', 'events', 'stream', 'util', 'net', 'tls',
  'http', 'https', 'crypto', 'zlib', 'url', 'querystring',
  'child_process', 'buffer', 'dns', 'dgram', 'assert', 'constants',
  'readline', 'string_decoder', 'timers', 'tty', 'worker_threads'
])

// Packages that must be externalized because they break when bundled
// (fastify ecosystem uses internal file resolution that doesn't survive bundling)
const externalPackages = [
  'fastify', '@fastify/cors', '@fastify/static'
]

// Stub native .node addons (ssh2/cpu-features have JS fallbacks)
function nativeModuleStub(): Plugin {
  const STUB_ID = '\0native-stub'
  return {
    name: 'native-module-stub',
    resolveId(source) {
      if (source.endsWith('.node')) return STUB_ID
      return null
    },
    load(id) {
      if (id === STUB_ID) return 'export default {}'
      return null
    }
  }
}

// Stub out Electron imports with empty modules
const electronModules = new Set(['electron', 'electron-updater'])

function electronStub(): Plugin {
  const ELECTRON_STUB_ID = '\0electron-stub'
  // Comprehensive stub covering all electron exports used in the codebase
  const electronStubCode = `
const noop = () => {};
const noopClass = class {};
const handler = { get: () => noop };
const proxyObj = new Proxy({}, handler);
export const app = proxyObj;
export const BrowserWindow = noopClass;
export const ipcMain = { handle: noop, on: noop, removeHandler: noop };
export const shell = { openPath: noop, openExternal: noop };
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
export const Notification = class { show() {} };
export default proxyObj;
`
  return {
    name: 'electron-stub',
    // Use enforce: 'pre' to intercept before Vite's SSR externalization
    enforce: 'pre',
    resolveId(source) {
      if (electronModules.has(source)) return ELECTRON_STUB_ID
      return null
    },
    load(id) {
      if (id === ELECTRON_STUB_ID) return electronStubCode
      return null
    }
  }
}

export default defineConfig({
  plugins: [nativeModuleStub(), electronStub()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@preload': resolve(__dirname, 'src/preload')
    }
  },
  ssr: {
    // Force Vite to bundle these instead of externalizing them
    // (SSR mode externalizes all node_modules by default)
    noExternal: true
  },
  build: {
    outDir: 'dist-standalone',
    target: 'node20',
    ssr: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/main/standalone.ts')
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs'
      },
      external: (id) => {
        // Externalize Node.js built-ins
        if (id.startsWith('node:')) return true
        if (nodeBuiltins.has(id)) return true
        // Externalize packages that break when bundled
        if (externalPackages.some(pkg => id === pkg || id.startsWith(pkg + '/'))) return true
        return false
      }
    },
    minify: false,
    sourcemap: true
  }
})
