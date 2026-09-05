import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import pino from 'pino';
import { registerBrotliRoutes } from './server/src/modules/brotli/routes/brotli.js';
import { NodeBrotliCodec } from './server/src/modules/brotli/services/node-brotli-codec.js';
import { CompressContentUseCase } from './server/src/modules/brotli/usecases/compress-content.js';
import { DecompressContentUseCase } from './server/src/modules/brotli/usecases/decompress-content.js';

const log = pino({ level: 'silent' });
const app = Fastify();
await app.register(async (scope) => {
  await scope.register(rateLimit, { global: false });
  const codec = new NodeBrotliCodec();
  registerBrotliRoutes(scope as never, {
    compress: new CompressContentUseCase({ codec, log: log as never, maxInputBytes: 1024 * 1024 }),
    decompress: new DecompressContentUseCase({ codec, log: log as never, maxOutputBytes: 4 * 1024 * 1024 }),
    log: log as never,
    maxInputBytes: 1024 * 1024,
    maxInputMb: 1,
    maxOutputMb: 4,
    rateLimitPerMinute: 1000,
  });
});
await app.listen({ port: 4747, host: '127.0.0.1' });
console.log('listening');
