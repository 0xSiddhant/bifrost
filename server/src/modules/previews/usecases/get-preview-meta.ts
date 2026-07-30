import path from 'node:path';
import { AppError } from '../../../core/http/index.js';
import { resolveKind } from '../kind.js';
import type { DownloadInspector, FileInspector, PreviewMeta } from '../ports.js';

/**
 * What a stored file is, and whether the browser can show it. Sniffed bytes
 * outrank the extension; the decision itself lives in the pure `resolveKind`.
 */
export class GetPreviewMetaUseCase {
  constructor(private readonly inspector: FileInspector) {}

  async byName(name: string): Promise<PreviewMeta> {
    try {
      const { size } = await this.inspector.stat(name);
      const sniffedMime = await this.inspector.sniffMime(name);
      const probablyText = sniffedMime ? false : await this.inspector.looksLikeText(name);
      const { kind, mime, previewable } = resolveKind({
        sniffedMime,
        ext: path.extname(name).toLowerCase(),
        probablyText,
        size,
      });
      return { previewable, kind, mime, name, size };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Deleted mid-request or confinement failure — same opaque 404.
      throw new AppError('file not found', 404, 'NOT_FOUND');
    }
  }
}

/** The downloads flavour: resolve the opaque listing id, then inspect it. */
export class GetDownloadPreviewMetaUseCase {
  constructor(
    private readonly inspector: DownloadInspector,
    private readonly meta: GetPreviewMetaUseCase,
  ) {}

  async execute(id: string): Promise<PreviewMeta> {
    const name = await this.inspector.findNameById(id);
    if (!name) throw new AppError('file not found', 404, 'NOT_FOUND');
    return this.meta.byName(name);
  }
}
