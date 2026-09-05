/**
 * Pure byte helpers for the Brotli page — naming, sizing, encoding, and the
 * text/binary read. Nothing here touches the network or React, so all of it is
 * testable on its own.
 */

/**
 * How much of a blob the text/binary check looks at. Bounded on purpose, and
 * for the same reason the server's own `FsFileInspector.looksLikeText` bounds
 * it: once a small prefix has answered "is this text", scanning hundreds of
 * megabytes more for one byte value is wasted work. A decompressed output near
 * the output cap must never trigger a whole-blob scan.
 */
export const TEXT_SAMPLE_BYTES = 4096;

/** True when a bounded prefix holds no null byte — the same heuristic previews use. */
export function looksLikeText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, TEXT_SAMPLE_BYTES).includes(0);
}

/** Base64, chunked — `String.fromCharCode(...bytes)` overflows the stack on a big array. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * The inverse of `toBase64`, for pasting a compressed blob back in — the other
 * end of the trip "Copy as base64" exists for.
 *
 * Whitespace is stripped first because that is the real-world friction: the
 * `base64` CLI wraps at 76 columns, and a blob pulled out of a config file or
 * an env var arrives with newlines and indentation in it. Nothing else is
 * repaired — `null` means "this is not base64", which is something the page
 * has to be able to say plainly rather than guess around.
 */
export function fromBase64(text: string): Uint8Array | null {
  const packed = text.replace(/\s+/g, '');
  if (packed === '') return null;
  try {
    return Uint8Array.from(atob(packed), (character) => character.charCodeAt(0));
  } catch {
    // Ordinary validation control flow: "not base64" is this function's whole
    // answer, and the caller turns it into the message the user reads.
    return null;
  }
}

/**
 * Saved bytes as a percentage of the original; negative when it grew.
 *
 * Floored rather than rounded, on purpose: an extreme but real ratio (12.9 KB
 * down to 48 B) rounds to "100% smaller", which reads as though the content
 * vanished. Only genuinely empty output should ever say 100.
 */
export function savedPercent(originalBytes: number, resultBytes: number): number {
  if (originalBytes === 0) return 0;
  return Math.floor(((originalBytes - resultBytes) / originalBytes) * 100);
}

/**
 * The server sets no `Content-Disposition` at all, so every name is decided
 * here — the client already holds the bytes, and inventing filenames on the
 * server would mean a helper crossing a module boundary for no gain.
 */
export function compressedName(sourceName: string | null): string {
  return sourceName ? `${sourceName}.br` : 'compressed.br';
}

export function gzippedName(sourceName: string | null): string {
  return sourceName ? `${sourceName}.gz` : 'compressed.gz';
}

/** Strips a trailing `.br`; falls back to a name that matches what the bytes are. */
export function decompressedName(sourceName: string | null, isText: boolean): string {
  if (sourceName && sourceName.toLowerCase().endsWith('.br')) {
    const stripped = sourceName.slice(0, -3);
    if (stripped !== '') return stripped;
  }
  return isText ? 'decompressed.txt' : 'decompressed.bin';
}

/** Hands the browser a file to save, the one mechanism a Blob download has. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
