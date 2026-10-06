import fc from 'fast-check';
import type { Seeds } from '../support/seed.js';

/**
 * Per-operation hints that keep the fuzzer safe without weakening it
 * (PLAN-33). A hint narrows one field's generator or supplies a non-JSON
 * body; it never removes an operation from the coverage report — the
 * excluded ones are covered by the contract journeys and the security suite.
 */

/** Never fuzzed at random, each for a stated reason. */
export const EXCLUDED: Record<string, string> = {
  login:
    'the login throttle is process-wide and in-process: the security suite tests it on its own server',
  revokeSessions:
    'ends every admin session, the fuzzer’s own included: the security suite runs it last, deliberately',
  logout: 'ends the fuzzer’s admin session; the contract and security suites cover it',
  streamEvents: 'an endless stream, not a request/response: transport and contract cover it',
};

export interface HintContext {
  sinkBaseUrl: string;
  seeds: Seeds;
}

export interface Hint {
  /** Replace a body property's generator (JSON bodies only, top level). */
  body?: Record<string, fc.Arbitrary<unknown>>;
  /** Replace a query parameter's generator. */
  query?: Record<string, fc.Arbitrary<unknown>>;
  /** Mix a seeded value into a path parameter, so valid runs reach real resources. */
  params?: Record<string, fc.Arbitrary<string>>;
  /** A raw body for an operation whose body is not JSON. */
  raw?: fc.Arbitrary<{ body: Buffer | FormData; contentType?: string }>;
}

const octets = (max: number) =>
  fc
    .uint8Array({ minLength: 1, maxLength: max })
    .map((bytes) => ({ body: Buffer.from(bytes), contentType: 'application/octet-stream' }));

const either = (seeded: string, generated: fc.Arbitrary<string>) =>
  fc.oneof({ weight: 1, arbitrary: fc.constant(seeded) }, { weight: 2, arbitrary: generated });

const word = fc.stringMatching(/^[a-z0-9-]{1,12}$/);

export function hintsFor(context: HintContext): Record<string, Hint> {
  const { seeds } = context;
  const hints: Record<string, Hint> = {
    // Title enrichment fetches the saved URL: only ever the local sink.
    saveLink: { body: { url: word.map((name) => `${context.sinkBaseUrl}/page/${name}`) } },
    // Kept small: the payload is generated, not a fixture, but 100 MB per run is a load test.
    downloadTestPayload: { query: { mb: fc.double({ min: 0.01, max: 0.25, noNaN: true }) } },
    uploadTestPayload: { raw: octets(64 * 1024) },
    brotliCompress: { raw: octets(16 * 1024) },
    brotliDecompress: { raw: octets(1024) },
    uploadFiles: {
      raw: fc.tuple(word, fc.uint8Array({ maxLength: 4096 })).map(([name, bytes]) => {
        const form = new FormData();
        form.append('files', new Blob([bytes]), `fuzz-${name}.txt`);
        return { body: form };
      }),
    },
    getDownloadContent: { params: { id: either(seeds.downloadFile, word) } },
    getDownloadPreviewMeta: { params: { id: either(seeds.downloadFile, word) } },
    getDownloadArchive: { params: { id: either(seeds.downloadFolder, word) } },
    getUploadContent: { params: { name: either(seeds.upload, word) } },
    getUploadPreviewMeta: { params: { name: either(seeds.upload, word) } },
    getTheme: { params: { id: either(seeds.theme, word) } },
    followPortkey: { params: { slug: either(seeds.portkey, word) } },
    updatePortkey: { params: { slug: either(seeds.portkey, word) } },
    updateLink: { params: { id: either(seeds.accio, word) } },
  };
  for (const [kind, doc] of Object.entries(seeds.documents)) {
    const Kind = { runestone: 'Runestone', edda: 'Edda', groot: 'GrootDoc', atlas: 'AtlasDoc' }[
      kind
    ];
    hints[`get${Kind}`] = { params: { slug: either(doc.slug, word) } };
    hints[`get${Kind}Raw`] = { params: { slug: either(doc.slug, word) } };
    hints[`update${Kind}`] = { params: { id: either(doc.id, word) } };
  }
  return hints;
}
