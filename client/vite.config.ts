import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';

// Dev proxy target must match the server's PORT from the repo-root .env
// (vite runs with cwd=client/, so resolve the path explicitly).
dotenv.config({ path: '../.env', quiet: true });
const serverPort = Number(process.env.PORT) || 4646;
const mdnsHost = `${process.env.MDNS_NAME || 'bifrost'}.local`;

export default defineConfig({
  plugins: [react()],
  server: {
    // Explicit IPv4 wildcard: `host: true` binds an IPv6 socket whose
    // v4-mapped dual-stack accept does not work reliably on macOS, leaving
    // LAN devices unable to reach the dev server by IPv4 address.
    host: '0.0.0.0',
    allowedHosts: [mdnsHost],
    proxy: {
      '/api': { target: `http://localhost:${serverPort}` },
      // public runestone data endpoint lives outside /api (PLAN-07 addendum)
      '/runestone/api': { target: `http://localhost:${serverPort}` },
      // public edda raw-markdown endpoint lives outside /api (PLAN-11)
      '/edda/api': { target: `http://localhost:${serverPort}` },
      // portkey go-link redirects live outside /api (PLAN-15)
      '/go': { target: `http://localhost:${serverPort}` },
    },
  },
});
