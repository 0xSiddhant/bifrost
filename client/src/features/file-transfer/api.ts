import { apiGet, apiSend } from '../../core/api';

export interface UploadConfig {
  maxUploadSizeMb: number;
  maxFilesPerUpload: number;
  blockedExtensions: string[];
}

export interface UploadOutcome {
  accepted: { name: string; storedName: string; size: number }[];
  rejected: { name: string; reason: string }[];
}

export const fetchUploadConfig = (): Promise<UploadConfig> =>
  apiGet<UploadConfig>('/api/files/config');

export class UploadCancelledError extends Error {
  override name = 'UploadCancelledError';
}

/** What the four staging actions answer with (PLAN-17b). */
export interface StagedFileResult {
  finalName: string;
  /** The wanted name was taken, so a `-1` style suffix was added. */
  renamed: boolean;
}

const seg = (name: string): string => encodeURIComponent(name);

/** Move a staged upload into downloads/, where the whole LAN can see it. */
export const publishUpload = (name: string): Promise<StagedFileResult> =>
  apiSend<StagedFileResult>('POST', `/api/files/${seg(name)}/publish`);

/** Rename within uploads/. A name the server would clean up comes back 422. */
export const renameUpload = (name: string, newName: string): Promise<StagedFileResult> =>
  apiSend<StagedFileResult>('PATCH', `/api/files/${seg(name)}`, { name: newName });

export const deleteUpload = (name: string): Promise<null> =>
  apiSend<null>('DELETE', `/api/files/${seg(name)}`);

export const uploadContentUrl = (name: string, options: { inline?: boolean } = {}): string =>
  `/api/files/${seg(name)}/content${options.inline ? '?inline=1' : ''}`;

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
