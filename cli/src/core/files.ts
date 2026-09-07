import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiClient, UploadInput } from './client.js';
import { CliError, EXIT } from './output.js';

/**
 * Push and pull. The listing shape is the server's own `DownloadEntry`, folder
 * rows and all (PLAN-24 landed between this plan being drafted and implemented),
 * so `GET /api/downloads` is one flat array covering root files, folders, and
 * every folder's files — the client filters it, the server never nests it.
 */

export type UploadRejectionReason =
  | 'too-large'
  | 'blocked-extension'
  | 'upload-failed'
  | 'folder-conflict';

export interface UploadResult {
  accepted: { name: string; storedName: string; size: number; folder?: string }[];
  rejected: { name: string; reason: UploadRejectionReason }[];
}

export interface DownloadEntry {
  id: string;
  /** Base name — never folder-qualified; `parent` carries the folder. */
  name: string;
  size: number;
  mtime: number;
  ext: string;
  type: 'file' | 'folder';
  parent: string | null;
}

/** How a row is addressed and shown: `notes.txt`, or `Trip/notes.txt`. */
export function displayPath(entry: Pick<DownloadEntry, 'name' | 'parent'>): string {
  return entry.parent === null ? entry.name : `${entry.parent}/${entry.name}`;
}

/**
 * Every file in one invocation goes in one request: `POST /api/files` already
 * accepts up to `MAX_FILES_PER_UPLOAD` of them, so there is no reason to pay N
 * connection setups. Local problems (a missing path, a directory) are refused
 * here, before anything is sent, so a batch is never half-uploaded over a typo.
 */
export async function pushFiles(client: ApiClient, paths: readonly string[]): Promise<UploadResult> {
  const inputs: UploadInput[] = paths.map((filePath) => {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      throw new CliError(`no such file: ${filePath}`, EXIT.notFound);
    }
    if (stats.isDirectory()) {
      throw new CliError(`${filePath} is a folder — push its files instead`);
    }
    if (!stats.isFile()) {
      throw new CliError(`${filePath} is not a regular file`);
    }
    return { path: filePath, name: path.basename(filePath), size: stats.size };
  });

  return client.postFiles<UploadResult>('pushing files', '/api/files', inputs);
}

export function listDownloads(client: ApiClient): Promise<DownloadEntry[]> {
  return client.json<DownloadEntry[]>('listing downloads', 'GET', '/api/downloads');
}

/**
 * Finds the one file a name refers to.
 *
 * The exact path wins first, so `shared.txt` always means the root file of that
 * name even when a folder holds one too, and `Trip/shared.txt` names the other.
 * Only when nothing matches exactly does a bare name fall back to matching
 * across folders — and if two folders hold it, the ambiguity is reported with
 * both qualified paths rather than guessed at.
 */
export function findDownload(entries: readonly DownloadEntry[], wanted: string): DownloadEntry {
  const target = wanted.replace(/^\.?\//, '');
  const files = entries.filter((entry) => entry.type === 'file');
  const exact = files.filter((entry) => displayPath(entry) === target);
  if (exact.length === 1) return exact[0] as DownloadEntry;

  const byName = files.filter((entry) => entry.name === target);
  if (byName.length === 1) return byName[0] as DownloadEntry;
  if (byName.length > 1) {
    const options = byName.map(displayPath).join(', ');
    throw new CliError(
      `"${target}" matches more than one file — name the folder too: ${options}`,
      EXIT.notFound,
    );
  }
  throw new CliError(`no download named "${wanted}" — run \`bifrost pull\` to list them`, EXIT.notFound);
}

/**
 * Streams one download to disk. It lands as `<dest>.part` and is renamed only
 * once the last byte is written, so an interrupted pull can never leave a
 * truncated file wearing the real name.
 */
export async function pullFile(
  client: ApiClient,
  entry: DownloadEntry,
  destination: string,
): Promise<number> {
  if (fs.existsSync(destination)) {
    throw new CliError(`${destination} already exists — pass --out <path> to write somewhere else`);
  }
  const response = await client.open(`pulling ${displayPath(entry)}`, `/api/downloads/${entry.id}/content`);
  if (response.body === null) {
    throw new CliError(`pulling ${displayPath(entry)} failed: the bridge sent no body`);
  }

  const partial = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
    fs.renameSync(partial, destination);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw new CliError(`pulling ${displayPath(entry)} failed: ${(error as Error).message}`);
  }
  return fs.statSync(destination).size;
}
