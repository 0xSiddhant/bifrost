import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';

// Dev proxy target must match the server's PORT from the repo-root .env
// (vite runs with cwd=client/, so resolve the path explicitly).
dotenv.config({ path: '../.env', quiet: true });
const serverPort = Number(process.env.PORT) || 4646;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': { target: `http://localhost:${serverPort}` },
    },
  },
});
