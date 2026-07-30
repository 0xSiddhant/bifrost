import { randomBytes, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Putting a file into a folder under a name that is free — the one operation
 * shared by "an upload lands in uploads/" and "a move lands in downloads/".
 *
 * **Why `link()` and not `open(wx)` + `rename()`.** The old upload path
 * reserved a name by creating an empty file, then renamed the real one onto
 * it; a crash between those two steps left a **zero-byte file under the final
 * name** — a real-looking, announced, empty download. `link()` does both jobs
 * in one atomic syscall: it fails with EEXIST if the name is taken (so it is
 * still a no-overwrite reservation) and, when it succeeds, the name already
 * carries the complete content. There is no window in which a truncated or
 * empty file is visible.
 *
 * The caller unlinks the source afterwards, which is what makes a move a move.
 * Between the link and that unlink the bytes exist under both names — one hard
 * link, so no disk is used twice, and `sweepPublishedDuplicates` clears any
 * that a crash strands (see below).
 */

/**
 * Past this many collisions the folder is telling us something (a script
 * looping, or a genuinely popular name) and probing `name-51`, `name-52`, …
 * one `link()` at a time is a syscall storm in the upload hot path. The old
 * loop had **no bound at all** — its comment excused that with the timestamp
 * prefix this plan removes.
 */
export const MAX_DEDUPE_ATTEMPTS = 50;

/** Prefix for the cross-device staging copy; dot-hidden so no listing shows it. */
const INFLIGHT_PREFIX = '.bifrost-inflight-';

export interface Placement {
  /** The name actually used — `report.pdf`, `report-1.pdf`, `report-a7f3.pdf`. */
  finalName: string;
  /** True when the desired name was taken and a suffix had to be added. */
  renamed: boolean;
}

/**
 * Hard-link `sourcePath` into `dir` under `desiredName`, disambiguating on
 * collision. The source is left alone — callers that are *moving* unlink it
 * once this resolves.
 */
export async function placeFile(
  dir: string,
  sourcePath: string,
  desiredName: string,
): Promise<Placement> {
  const ext = path.extname(desiredName);
  const stem = desiredName.slice(0, desiredName.length - ext.length);

  for (let attempt = 0; attempt <= MAX_DEDUPE_ATTEMPTS; attempt += 1) {
    const finalName = attempt === 0 ? desiredName : `${stem}-${attempt}${ext}`;
    try {
      await linkInto(dir, sourcePath, finalName);
      return { finalName, renamed: attempt > 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  // Beyond the cap: stop counting and take a short random suffix. One more
  // syscall instead of an unbounded scan, and `report-a7f3.pdf` still reads as
  // a file rather than as a hash.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const finalName = `${stem}-${randomBytes(2).toString('hex')}${ext}`;
    try {
      await linkInto(dir, sourcePath, finalName);
      return { finalName, renamed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`could not find a free name for ${desiredName} in ${dir}`);
}

/**
 * `link()` across filesystems fails with EXDEV. Both storage folders sit under
 * `storage/` today, but every path is independently configurable, so downloads/
 * can legitimately be a mounted volume. The fallback copies through a
 * dot-hidden staging file **inside the destination folder** — so the final
 * `link()` is same-directory and cannot be EXDEV — and fsyncs before linking,
 * because a copy that is only in the page cache is not a copy.
 */
async function linkInto(dir: string, sourcePath: string, finalName: string): Promise<void> {
  const target = path.join(dir, finalName);
  try {
    await fsp.link(sourcePath, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }

  const staging = path.join(dir, `${INFLIGHT_PREFIX}${randomUUID()}`);
  try {
    await fsp.copyFile(sourcePath, staging);
    const handle = await fsp.open(staging, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.link(staging, target);
  } finally {
    // The staging copy has served its purpose either way; on the failure path
    // leaving it would strand a full-size hidden file on every retry.
    await fsp.rm(staging, { force: true });
  }
}

/**
 * Boot reconciliation for the one window `placeFile` cannot close: a crash
 * after the link into downloads/ but before the source in uploads/ was
 * unlinked leaves the same inode under both names, so a moved file appears to
 * be in two places at once (the invariant PLAN-17b's kill test asserts).
 *
 * Identity is `dev:ino`, not the name — a *different* file that merely shares
 * a name is a genuine coincidence and must be left alone.
 */
export async function sweepPublishedDuplicates(
  uploadsDir: string,
  downloadsDir: string,
): Promise<string[]> {
  const published = new Set<string>();
  for (const entry of await readFiles(downloadsDir)) {
    published.add(`${entry.dev}:${entry.ino}`);
  }
  if (published.size === 0) return [];

  const swept: string[] = [];
  for (const entry of await readFiles(uploadsDir)) {
    if (!published.has(`${entry.dev}:${entry.ino}`)) continue;
    await fsp.rm(path.join(uploadsDir, entry.name), { force: true });
    swept.push(entry.name);
  }
  return swept;
}

async function readFiles(dir: string): Promise<{ name: string; dev: number; ino: number }[]> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    // A missing storage folder is a boot-time config problem that surfaces far
    // more loudly elsewhere; the sweep simply has nothing to do.
    return [];
  }
  const files = [];
  for (const name of names) {
    try {
      const stat = await fsp.stat(path.join(dir, name));
      if (stat.isFile()) files.push({ name, dev: stat.dev, ino: stat.ino });
    } catch {
      // Vanished between readdir and stat — nothing to reconcile.
    }
  }
  return files;
}
