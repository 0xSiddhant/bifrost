import rateLimit from '@fastify/rate-limit';
import type { FeatureModule } from '../../core/module.js';
import { registerBrotliRoutes } from './routes/brotli.js';
import { NodeBrotliCodec } from './services/node-brotli-codec.js';
import { CompressContentUseCase } from './usecases/compress-content.js';
import { DecompressContentUseCase } from './usecases/decompress-content.js';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Brotli (PLAN-25): compress and decompress arbitrary bytes through Node's
 * built-in `zlib` — the same reference codec (`libbrotli`) every browser and
 * the standalone `brotli` CLI use, so output is byte-format standard.
 *
 * The codec lives here rather than in the browser because the Compression
 * Streams API supports gzip and deflate only; Brotli is not one of its formats
 * in any current browser. A bundled WASM codec was the alternative and would
 * have cost every other tool bundle size for one page's benefit.
 *
 * **The server never inspects what it moves.** Bytes in, bytes out — the same
 * posture Groot states for YAML and Atlas for XML. Every question about what
 * the content *is* (is it text, is it JSON, which tool could open it) is
 * answered client-side, on bytes the browser already holds.
 *
 * Both profiles: this is a stateless, byte-capped transform, the class
 * `GROOT_MAX_DOC_KB`/`ATLAS_MAX_DOC_KB` already bound on the cloud profile —
 * not file-transfer's class. Its one genuinely new risk, a decompression bomb,
 * is bounded by `BROTLI_MAX_OUTPUT_MB` rather than by which profile is running.
 */
export const brotliModule: FeatureModule = {
  name: 'brotli',
  async register(app, deps) {
    const { config, log } = deps;
    await app.register(rateLimit, { global: false });

    const codec = new NodeBrotliCodec();
    const maxInputBytes = config.brotli.maxInputMb * BYTES_PER_MB;

    registerBrotliRoutes(app, {
      compress: new CompressContentUseCase({ codec, log, maxInputBytes }),
      decompress: new DecompressContentUseCase({
        codec,
        log,
        maxOutputBytes: config.brotli.maxOutputMb * BYTES_PER_MB,
      }),
      log,
      maxInputBytes,
      maxInputMb: config.brotli.maxInputMb,
      maxOutputMb: config.brotli.maxOutputMb,
      rateLimitPerMinute: config.brotli.rateLimitPerMin,
    });
  },
};
