import type { PreviewKind } from './kind.js';

export interface PreviewMeta {
  previewable: boolean;
  kind: PreviewKind;
  mime: string;
  name: string;
  size: number;
}

/**
 * Read-only view over downloads/ for preview metadata. Previews never talks
 * to file-transfer — ids are re-derived from filenames via core/download-id,
 * so both modules resolve the same id independently.
 */
export interface DownloadInspector {
  findNameById(id: string): Promise<string | null>;
  stat(name: string): Promise<{ size: number }>;
  sniffMime(name: string): Promise<string | undefined>;
  /** True when a leading sample of the file contains no null bytes. */
  looksLikeText(name: string): Promise<boolean>;
}
