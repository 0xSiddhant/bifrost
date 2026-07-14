/**
 * Extension → mime for inline serving. Deliberately tiny: it covers what the
 * preview viewers and native browser elements need. The previews module's
 * byte sniffing is the source of truth for *what a file is* — this map only
 * decides the Content-Type header once a preview is already being served.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Never text/html: an inline-served page would run same-origin scripts.
  // Previews show HTML as source instead.
  '.html': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
};

export const FALLBACK_MIME = 'application/octet-stream';

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? FALLBACK_MIME;
}
