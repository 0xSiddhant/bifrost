import { API_V1, apiGet, apiSend } from '../../core/api';

export interface ClipboardEntry {
  id: string;
  text: string;
  kind: 'text' | 'code';
  lang: string | null;
  deviceId: string | null;
  createdAt: number;
}

export type ClipboardChange =
  | { action: 'add'; entry: ClipboardEntry }
  | { action: 'delete'; id: string };

export interface NewClipboardEntry {
  text: string;
  kind?: 'text' | 'code';
  lang?: string;
  ttlSeconds?: number;
}

export const listClipboard = (): Promise<ClipboardEntry[]> =>
  apiGet<ClipboardEntry[]>(`${API_V1}/clipboard`);

export const addClipboard = (input: NewClipboardEntry): Promise<ClipboardEntry> =>
  apiSend<ClipboardEntry>('POST', `${API_V1}/clipboard`, input);

export const deleteClipboard = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `${API_V1}/clipboard/${id}`);
