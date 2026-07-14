import { apiGet } from '../../core/api';

export interface DownloadEntry {
  id: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
}

export interface UploadConfig {
  maxUploadSizeMb: number;
  maxFilesPerUpload: number;
  blockedExtensions: string[];
}

export interface UploadOutcome {
  accepted: { name: string; storedName: string; size: number }[];
  rejected: { name: string; reason: string }[];
}

export const listDownloads = (): Promise<DownloadEntry[]> =>
  apiGet<DownloadEntry[]>('/api/downloads');

export const fetchUploadConfig = (): Promise<UploadConfig> =>
  apiGet<UploadConfig>('/api/files/config');

export const downloadUrl = (id: string): string => `/api/downloads/${id}/content`;

export class UploadCancelledError extends Error {
  override name = 'UploadCancelledError';
}

const REJECTION_TEXT: Record<string, string> = {
  'too-large': 'file is larger than the server allows',
  'blocked-extension': 'this file type is blocked',
  'upload-failed': 'the transfer broke mid-stream — nothing partial was kept',
};

export interface UploadTask {
  /** Resolves with the stored name; rejects with UploadCancelledError on cancel. */
  promise: Promise<string>;
  cancel: () => void;
}

/**
 * One file per request, via XHR — fetch still has no upload progress events.
 * Per-file requests give independent progress, retry, and cancel for free.
 */
export function uploadFile(file: File, onProgress: (percent: number) => void): UploadTask {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<string>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onabort = () => reject(new UploadCancelledError('upload cancelled'));
    xhr.onerror = () => reject(new Error('connection interrupted'));
    xhr.onload = () => {
      let outcome: UploadOutcome | null = null;
      try {
        outcome = JSON.parse(xhr.responseText) as UploadOutcome;
      } catch {
        // fall through to the generic error below
      }
      const rejection = outcome?.rejected[0];
      if (rejection) {
        reject(new Error(REJECTION_TEXT[rejection.reason] ?? 'upload rejected'));
      } else if (xhr.status === 201 && outcome?.accepted[0]) {
        resolve(outcome.accepted[0].storedName);
      } else {
        reject(new Error(`upload failed (${xhr.status})`));
      }
    };

    const form = new FormData();
    form.append('files', file, file.name);
    xhr.open('POST', '/api/files');
    xhr.send(form);
  });

  return { promise, cancel: () => xhr.abort() };
}
