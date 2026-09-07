import type { ApiClient } from './client.js';

/** Hermes, the shared clipboard. A thin pass-through: the server owns every rule. */

export interface ClipboardEntry {
  id: string;
  text: string;
  kind: 'text' | 'code';
  lang: string | null;
  deviceId: string | null;
  createdAt: number;
}

export interface AddClipboardInput {
  text: string;
  kind?: 'text' | 'code';
  lang?: string;
  ttlSeconds?: number;
}

export function listClipboard(client: ApiClient): Promise<ClipboardEntry[]> {
  return client.json<ClipboardEntry[]>('reading the clipboard', 'GET', '/api/clipboard');
}

export function addClipboard(client: ApiClient, input: AddClipboardInput): Promise<ClipboardEntry> {
  return client.json<ClipboardEntry>('adding to the clipboard', 'POST', '/api/clipboard', {
    body: input,
  });
}

export function removeClipboard(client: ApiClient, id: string): Promise<void> {
  return client.voidCall(
    'removing a clipboard entry',
    'DELETE',
    `/api/clipboard/${encodeURIComponent(id)}`,
  );
}
