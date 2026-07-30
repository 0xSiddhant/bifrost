import type { PreviewKind } from './kind.js';

export interface PreviewMeta {
  previewable: boolean;
  kind: PreviewKind;
  mime: string;
  name: string;
  size: number;
}

/**
 * Read-only view over one folder of stored files, for preview metadata.
 * Implementations enforce the realpath prefix check — the whole point of
 * routing preview reads through a named root rather than a path.
 */
export interface FileInspector {
  stat(name: string): Promise<{ size: number }>;
  sniffMime(name: string): Promise<string | undefined>;
  /** True when a leading sample of the file contains no null bytes. */
  looksLikeText(name: string): Promise<boolean>;
}

/**
 * The downloads flavour, which additionally resolves the opaque ids the
 * listing hands out. Previews never talks to file-transfer — ids are
 * re-derived from filenames via core/download-id, so both modules resolve the
 * same id independently. Uploads need no such lookup: PLAN-17b addresses a
 * staged file by the name its owner is looking at.
 */
export interface DownloadInspector extends FileInspector {
  findNameById(id: string): Promise<string | null>;
}
