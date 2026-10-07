/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import {
  buildManifest,
  buildOf,
  readBuildDefaults,
  type Build,
  type BuildDefaults,
} from './buildDefaults';

// Dev proxy target must match the server's PORT from the repo-root .env
// (vite runs with cwd=client/, so resolve the path explicitly).
dotenv.config({ path: '../.env', quiet: true });
const serverPort = Number(process.env.PORT) || 4646;
const mdnsHost = `${process.env.MDNS_NAME || 'bifrost'}.local`;

/**
 * `client/dist/bifrost-build.json`: the build and the editor caps it baked in.
 * The server reads it at boot and warns when its own `.env` caps differ, so a
 * forgotten client rebuild shows up in the log instead of as a late 413
 * (PLAN-35). Emitted for both builds; only the hub's is ever read.
 */
function buildManifestPlugin(build: Build, defaults: BuildDefaults): Plugin {
  return {
    name: 'bifrost-build-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'bifrost-build.json',
        source: `${JSON.stringify(buildManifest(build, defaults), null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const build = buildOf(mode);
  // Tests read the documented defaults, never a developer's own .env.
  const defaults = readBuildDefaults(mode === 'test' ? {} : process.env);
  const standalone = build === 'standalone';
  const hubTarget = { target: `http://localhost:${serverPort}` };
  // The standalone build talks to no server, so its dev server proxies nothing.
  const proxy: Record<string, typeof hubTarget> = standalone
    ? {}
    : {
        '/api': hubTarget,
        // public runestone data endpoint lives outside /api (PLAN-07 addendum)
        '/runestone/api': hubTarget,
        // public edda raw-markdown endpoint lives outside /api (PLAN-11)
        '/edda/api': hubTarget,
        // public groot raw-yaml endpoint lives outside /api (PLAN-19)
        '/groot/api': hubTarget,
        // public atlas raw-xml endpoint lives outside /api (PLAN-23)
        '/atlas/api': hubTarget,
        // portkey go-link redirects live outside /api (PLAN-15)
        '/go': hubTarget,
      };

  return {
    plugins: [react(), buildManifestPlugin(build, defaults)],
    define:
      mode === 'test'
        ? {
            // Under Vitest the build is a runtime global (default 'hub', set
            // in testSetup.ts), so a test can load a module as standalone.
            __BIFROST_BUILD__: 'globalThis.__BIFROST_BUILD__',
            __HUB__: "(globalThis.__BIFROST_BUILD__ !== 'standalone')",
            __BIFROST_DEFAULTS__: JSON.stringify(defaults),
          }
        : {
            // Literals, so Rollup drops the other build's branches: the
            // standalone bundle carries no hub request code at all.
            __BIFROST_BUILD__: JSON.stringify(build),
            __HUB__: JSON.stringify(!standalone),
            __BIFROST_DEFAULTS__: JSON.stringify(defaults),
          },
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      // Without maps every stack reported to /api/client-logs reads
      // `AccioPage-B1aK7NYQ.js:1:48122` — enough to know something broke, useless
      // for knowing where, which is most of the value. On a LAN-only app there is
      // no reason to withhold source from your own network, and browsers fetch
      // maps only when devtools is open. ('hidden' would keep them off the wire
      // but means resolving every trace by hand — the wrong trade here.) The
      // public standalone site reports nothing anywhere, so it ships none.
      sourcemap: !standalone,
    },
    test: {
      setupFiles: ['./src/testSetup.ts'],
    },
    server: {
      // Explicit IPv4 wildcard: `host: true` binds an IPv6 socket whose
      // v4-mapped dual-stack accept does not work reliably on macOS, leaving
      // LAN devices unable to reach the dev server by IPv4 address.
      host: '0.0.0.0',
      allowedHosts: [mdnsHost],
      proxy,
    },
  };
});
