process.on('uncaughtException', (e: Error) => { console.log('UNCAUGHT:', e.name, '|', e.message); console.log((e.stack ?? '').split('\n').slice(0,12).join('\n')); });
process.on('unhandledRejection', (e: unknown) => { console.log('UNHANDLED REJECTION:', (e as Error)?.stack); });
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import pino from 'pino';
import { createApp } from './server/src/app.js';
import { loadConfig } from './server/src/core/config/index.js';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-probe-'));
const app = await createApp(
  loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, BROTLI_MAX_INPUT_MB: '1' }),
  { logger: pino({ level: 'silent' }) },
);
const response = await app.fastify.inject({
  method: 'POST',
  url: '/api/brotli/compress',
  payload: Readable.from([Buffer.alloc(2 * 1024 * 1024)]),
  headers: { 'content-type': 'application/octet-stream' },
});
console.log('STATUS', response.statusCode, response.body.slice(0, 200));
await new Promise((r) => setTimeout(r, 500));
await app.shutdown();
fs.rmSync(storageRoot, { recursive: true, force: true });
