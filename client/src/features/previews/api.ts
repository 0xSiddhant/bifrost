import { API_V1, apiGet } from '../../core/api';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'none';

export interface PreviewMeta {
  previewable: boolean;
  kind: PreviewKind;
  mime: string;
  name: string;
  size: number;
}

export const fetchPreviewMeta = (id: string): Promise<PreviewMeta> =>
  apiGet<PreviewMeta>(`${API_V1}/downloads/${id}/meta`);

/**
 * Metadata for a staged upload (PLAN-17b). Same contract as the downloads
 * one; the file is addressed by its name, because that is what its sender is
 * looking at — there is no listing to hand out opaque ids.
 */
export const fetchUploadPreviewMeta = (name: string): Promise<PreviewMeta> =>
  apiGet<PreviewMeta>(`${API_V1}/files/${encodeURIComponent(name)}/preview`);
