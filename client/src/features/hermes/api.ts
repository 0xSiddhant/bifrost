import { apiGet, apiSend } from '../../core/api';

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
  apiGet<ClipboardEntry[]>('/api/clipboard');

export const addClipboard = (input: NewClipboardEntry): Promise<ClipboardEntry> =>
  apiSend<ClipboardEntry>('POST', '/api/clipboard', input);

export const deleteClipboard = (id: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/clipboard/${id}`);
