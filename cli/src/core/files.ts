import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiClient, UploadInput } from './client.js';
import { CliError, EXIT, type ProgressHandle } from './output.js';

/**
 * Push and pull. The listing shape is the server's own `DownloadEntry`, folder
 * rows and all (PLAN-24), so `GET /api/downloads` is one flat array covering
 * root files, folders, and every folder's files — the client filters it, the
 * server never nests it.
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

/** The limits the server actually enforces — read, never hardcoded. */
export interface UploadConfig {
  maxUploadSizeMb: number;
  maxFilesPerUpload: number;
  blockedExtensions: string[];
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

/** Builds a bar for one transfer. Injected so only `output.ts` knows about TTYs. */
export type ProgressFactory = (label: string, total: number) => ProgressHandle;

/** How a row is addressed and shown: `notes.txt`, or `Trip/notes.txt`. */
export function displayPath(entry: Pick<DownloadEntry, 'name' | 'parent'>): string {
  return entry.parent === null ? entry.name : `${entry.parent}/${entry.name}`;
}

export function getUploadConfig(client: ApiClient): Promise<UploadConfig> {
  return client.json<UploadConfig>('reading the upload limits', 'GET', '/api/files/config');
}

export interface ExpandedInputs {
  files: UploadInput[];
  /** Dotfiles skipped while expanding a directory, so the command can say so. */
  hidden: number;
  /** Sub-directories skipped, for the same reason. */
  nested: number;
}

/**
 * Turns what was typed into the files to send.
 *
 * A directory (`.`, `~/Downloads`, `photos/`) expands to the regular files
 * **directly inside it** — deliberately not recursively. `uploads/` is flat and
 * `downloads/` is exactly one level deep, so a nested tree has nowhere to land;
 * flattening one would silently collide names that the tree kept apart. Hidden
 * files are skipped: `push .` in a project directory should not put `.env` on
 * a share every device can read.
 *
 * Local problems are refused here, before anything is sent, so a batch is never
 * half-uploaded over a typo.
 */
export function expandUploadInputs(paths: readonly string[]): ExpandedInputs {
  const files: UploadInput[] = [];
  const seen = new Set<string>();
  let hidden = 0;
  let nested = 0;

  const add = (filePath: string, stats: fs.Stats): void => {
    // Resolved, not as typed: the upload streams later, and a relative path
    // would be read against whatever the working directory is by then.
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    files.push({ path: resolved, name: path.basename(resolved), size: stats.size });
  };

  for (const input of paths) {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(input);
    } catch {
      throw new CliError(`no such file or folder: ${input}`, EXIT.notFound);
    }

    if (stats.isFile()) {
      add(input, stats);
      continue;
    }
    if (!stats.isDirectory()) {
      throw new CliError(`${input} is not a regular file`);
    }

    for (const entry of fs.readdirSync(input, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) {
        hidden += 1;
        continue;
      }
      const child = path.join(input, entry.name);
      let childStats: fs.Stats;
      try {
        childStats = fs.statSync(child);
      } catch {
        // Vanished between readdir and stat — a build directory being cleaned
        // under us. Skipping it is right; failing the whole push is not.
        continue;
      }
      if (childStats.isDirectory()) {
        nested += 1;
        continue;
      }
      if (childStats.isFile()) add(child, childStats);
    }
  }

  if (files.length === 0) {
    throw new CliError(`nothing to push — ${paths.join(', ')} holds no files`, EXIT.notFound);
  }
  return { files, hidden, nested };
}

/** Splits into requests the server will accept whole. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const limit = Number.isFinite(size) && size > 0 ? Math.floor(size) : items.length;
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    batches.push(items.slice(index, index + limit));
  }
  return batches;
}

export interface PushOptions {
  /** Destination folder under downloads/. Skips staging entirely (PLAN-24). */
  folder?: string;
  progress?: ProgressFactory;
}

/**
 * Sends every named file, in as few requests as the server allows.
 *
 * One request per `MAX_FILES_PER_UPLOAD` files — read from `/api/files/config`
 * rather than assumed, because past that cap busboy aborts the **whole**
 * request and a 50-file `push .` would otherwise fail entirely instead of
 * landing in three batches.
 */
export async function pushFiles(
  client: ApiClient,
  inputs: readonly UploadInput[],
  options: PushOptions = {},
): Promise<UploadResult> {
  const config = await getUploadConfig(client);
  const batches = chunk(inputs, config.maxFilesPerUpload);
  const merged: UploadResult = { accepted: [], rejected: [] };

  for (const [index, batch] of batches.entries()) {
    const label =
      batches.length === 1 ? 'sending' : `sending batch ${index + 1}/${batches.length}`;
    let bar: ProgressHandle | undefined;
    try {
      const result = await client.postFiles<UploadResult>('pushing files', '/api/files', batch, {
        ...(options.folder === undefined ? {} : { query: { folder: options.folder } }),
        onProgress: (sent, total) => {
          bar ??= options.progress?.(label, total);
          bar?.update(sent);
        },
      });
      merged.accepted.push(...result.accepted);
      merged.rejected.push(...result.rejected);
    } finally {
      bar?.stop();
    }
  }
  return merged;
}

export function listDownloads(client: ApiClient): Promise<DownloadEntry[]> {
  return client.json<DownloadEntry[]>('listing downloads', 'GET', '/api/downloads');
}

/**
 * Root files first, then each folder immediately followed by its own contents.
 *
 * The server's array is in watcher order, which interleaves a folder row with
 * unrelated files and reads as noise. Sorting is the client's job here for the
 * same reason it is on the Receive page: the feed is one flat array by design,
 * and how it is grouped is a presentation choice.
 */
export function sortForListing(entries: readonly DownloadEntry[]): DownloadEntry[] {
  const groupOf = (entry: DownloadEntry): string =>
    entry.type === 'folder' ? entry.name : (entry.parent ?? '');
  return [...entries].sort((a, b) => {
    const groupCompare = groupOf(a).localeCompare(groupOf(b));
    if (groupCompare !== 0) return groupCompare;
    // Within a group the folder's own row leads, then its files by name.
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Finds the one entry a name refers to — a file or a folder.
 *
 * The exact path wins first, so `shared.txt` always means the root file of that
 * name even when a folder holds one too, and `Trip/shared.txt` names the other.
 * Only when nothing matches exactly does a bare name fall back to matching
 * across folders — and if two folders hold it, the ambiguity is reported with
 * both qualified paths rather than guessed at.
 */
export function findEntry(entries: readonly DownloadEntry[], wanted: string): DownloadEntry {
  const target = wanted.replace(/^\.?\//, '').replace(/\/$/, '');
  const exact = entries.filter((entry) => displayPath(entry) === target);
  if (exact.length === 1) return exact[0] as DownloadEntry;

  const byName = entries.filter((entry) => entry.name === target);
  if (byName.length === 1) return byName[0] as DownloadEntry;
  if (byName.length > 1) {
    const options = byName.map(displayPath).join(', ');
    throw new CliError(
      `"${target}" matches more than one entry — name the folder too: ${options}`,
      EXIT.notFound,
    );
  }
  throw new CliError(
    `nothing called "${wanted}" is on offer — run \`bifrost pull --list\` to see what is`,
    EXIT.notFound,
  );
}

/** Where a downloaded entry lands by default, and what it is called. */
export function localNameFor(entry: DownloadEntry): string {
  return entry.type === 'folder' ? `${entry.name}.zip` : entry.name;
}

export interface PullResult {
  name: string;
  type: 'file' | 'folder';
  path: string;
  size: number;
}

/**
 * Streams one entry to disk — a file's bytes, or a folder as the zip the server
 * builds on the fly.
 *
 * It lands as `<dest>.part` and is renamed only once the last byte is written,
 * so an interrupted pull can never leave a truncated file wearing the real name.
 * A folder's zip carries no `content-length` (its size is unknown until the
 * archive is finalized), so that case gets a byte counter rather than a bar —
 * stated here because a bar against an unknown total is a lie.
 */
export async function pullEntry(
  client: ApiClient,
  entry: DownloadEntry,
  destination: string,
  progress?: ProgressFactory,
): Promise<PullResult> {
  if (fs.existsSync(destination)) {
    throw new CliError(`${destination} already exists — pass --out <path> to write somewhere else`);
  }
  const label = displayPath(entry);
  const route =
    entry.type === 'folder'
      ? `/api/downloads/${entry.id}/archive`
      : `/api/downloads/${entry.id}/content`;
  const response = await client.open(`pulling ${label}`, route);
  if (response.body === null) {
    throw new CliError(`pulling ${label} failed: the bridge sent no body`);
  }

  const declared = Number(response.headers.get('content-length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
  const bar = total > 0 ? progress?.(label, total) : undefined;

  const partial = `${destination}.part`;
  let written = 0;
  try {
    const source = Readable.fromWeb(response.body);
    source.on('data', (chunk: Buffer) => {
      written += chunk.length;
      bar?.update(written);
    });
    await pipeline(source, fs.createWriteStream(partial));
    fs.renameSync(partial, destination);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw new CliError(`pulling ${label} failed: ${(error as Error).message}`);
  } finally {
    bar?.stop();
  }

  return { name: label, type: entry.type, path: destination, size: fs.statSync(destination).size };
}
