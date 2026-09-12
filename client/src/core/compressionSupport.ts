/**
 * The browser's own Compression Streams API, used for exactly one thing: the
 * gzip size Brotli's page compares itself against (PLAN-25).
 *
 * Its supported formats are `gzip`, `deflate` and `deflate-raw` — Brotli is not
 * one of them in any current browser, which is the whole reason Brotli's codec
 * lives on the server. Gzip *is* there, though, so the comparison costs nothing:
 * no extra request, no dependency, and it shows why Brotli exists rather than
 * asserting it.
 *
 * Feature-detected rather than assumed, the same posture the SHA-256 toolbox
 * tool already takes for `crypto.subtle`'s secure-context gate: where the API
 * is missing the comparison is simply absent, never broken.
 */

export function hasCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * Gzips bytes in the browser. The blob is kept rather than discarded, so
 * "Download .gz" is free once the size has been computed for the comparison.
 */
export async function gzipBytes(bytes: Uint8Array): Promise<{ size: number; blob: Blob }> {
  // `new Response(bytes).body` rather than `new Blob([bytes]).stream()`: it is
  // one API instead of two for the same stream, and `Blob.stream` is the half
  // that is missing in some non-browser runtimes.
  const source = new Response(bytes as BodyInit).body;
  if (!source) throw new Error('the browser produced no readable body to compress');
  const blob = await new Response(source.pipeThrough(new CompressionStream('gzip'))).blob();
  return { size: blob.size, blob };
}
