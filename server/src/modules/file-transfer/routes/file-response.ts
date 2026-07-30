import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FALLBACK_MIME, mimeForExt } from '../../../core/http/mime.js';
import { parseRange } from '../../../core/http/range.js';
import type { DownloadContent } from '../ports.js';

export interface FileResponse {
  name: string;
  size: number;
  /** Render in the browser (previews) rather than offering a save dialog. */
  inline: boolean;
  open: (slice?: { start: number; end: number }) => Promise<DownloadContent>;
}

/**
 * Streams one stored file with range support — shared by downloads/ and
 * uploads/ (PLAN-17b gave uploads a content route, and two hand-written copies
 * of range parsing would eventually disagree about a 416).
 *
 * Content-Type comes from the extension **only when serving inline**; an
 * attachment is always `application/octet-stream`, so a downloaded file is
 * never something the browser decides to run.
 */
export async function respondWithFile(
  request: FastifyRequest,
  reply: FastifyReply,
  file: FileResponse,
): Promise<FastifyReply> {
  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', file.inline ? mimeForExt(path.extname(file.name)) : FALLBACK_MIME);
  reply.header(
    'content-disposition',
    `${file.inline ? 'inline' : 'attachment'}; ${dispositionFilename(file.name)}`,
  );

  const ranged = parseRange(request.headers.range, file.size);
  if (ranged.kind === 'unsatisfiable') {
    return reply
      .code(416)
      .header('content-range', `bytes */${file.size}`)
      .header('content-type', 'application/json; charset=utf-8')
      .send({ error: 'RANGE_NOT_SATISFIABLE', message: 'requested range not satisfiable' });
  }
  if (ranged.kind === 'partial') {
    const { start, end } = ranged.range;
    const { stream } = await file.open({ start, end });
    return reply
      .code(206)
      .header('content-range', `bytes ${start}-${end}/${file.size}`)
      .header('content-length', end - start + 1)
      .send(stream);
  }
  const { stream } = await file.open();
  return reply.header('content-length', file.size).send(stream);
}

/** RFC 6266/5987: ascii fallback plus UTF-8 filename* so unicode names survive. */
export function dispositionFilename(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
