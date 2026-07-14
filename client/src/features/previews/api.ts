import { apiGet } from '../../core/api';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'none';

export interface PreviewMeta {
  previewable: boolean;
  kind: PreviewKind;
  mime: string;
  name: string;
  size: number;
}

export const fetchPreviewMeta = (id: string): Promise<PreviewMeta> =>
  apiGet<PreviewMeta>(`/api/downloads/${id}/meta`);
