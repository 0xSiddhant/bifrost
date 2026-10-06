import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const exec = promisify(execFile);

/**
 * Copy a storage root so the copy is indistinguishable to the server: every
 * file's and every directory's mtime is set from the source after the copy.
 * The downloads and uploads listings report each entry's mtime, so a plain
 * copy would make every listing differ between the two sides for no reason.
 * Directories are stamped last, deepest first, because writing into a
 * directory moves its mtime.
 */
export function copyPreservingTimes(source: string, target: string): void {
  fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
  const directories: string[] = [];
  const walk = (relative: string) => {
    const from = path.join(source, relative);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(from)) walk(path.join(relative, name));
      directories.push(relative);
    } else {
      fs.utimesSync(path.join(target, relative), stat.atime, stat.mtime);
    }
  };
  walk('');
  for (const relative of directories.sort((a, b) => b.length - a.length)) {
    const stat = fs.statSync(path.join(source, relative));
    fs.utimesSync(path.join(target, relative), stat.atime, stat.mtime);
  }
}

/**
 * A consistent copy of a live database, with the same mechanism `npm run
 * backup` uses: `VACUUM INTO` on a **read-only** connection. The source is
 * never written, and the running server that owns it is never disturbed.
 */
export function snapshotDatabase(source: string, target: string): void {
  if (!fs.existsSync(source)) throw new Error(`no database at ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } finally {
    db.close();
  }
}

/** Row counts per table, for the run record — never any row's content. */
export function rowCounts(dbFile: string): Record<string, number> {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        (db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n,
      ]),
    );
  } finally {
    db.close();
  }
}

export function scratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface Worktree {
  root: string;
  ref: string;
  commit: string;
  remove(): Promise<void>;
}

/**
 * Build `ref`'s server in a temporary `git worktree`: a clean install of that
 * ref's own lockfile, then `npm run build -w server`. Its `client/dist` is
 * linked to this checkout's build, because the diff compares what the server
 * answers and the static bundle is not under test — and both sides then serve
 * the very same files.
 */
export async function buildWorktree(
  repoRoot: string,
  ref: string,
  log: (line: string) => void,
): Promise<Worktree> {
  const root = scratch('bifrost-api-diff-worktree-');
  fs.rmSync(root, { recursive: true, force: true });
  const { stdout: commit } = await exec('git', ['rev-parse', '--short', `${ref}^{commit}`], {
    cwd: repoRoot,
  });
  await exec('git', ['worktree', 'add', '--detach', root, ref], { cwd: repoRoot });
  const remove = async () => {
    await exec('git', ['worktree', 'remove', '--force', root], { cwd: repoRoot }).catch(
      () => undefined,
    );
    fs.rmSync(root, { recursive: true, force: true });
    await exec('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => undefined);
  };
  try {
    log(`  installing ${ref} (${commit.trim()}) dependencies…`);
    await exec('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: root,
      env: { ...process.env, CI: 'true', HUSKY: '0', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    log(`  building ${ref} server…`);
    await exec('npm', ['run', 'build', '-w', 'server'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    fs.mkdirSync(path.join(root, 'client'), { recursive: true });
    fs.rmSync(path.join(root, 'client', 'dist'), { recursive: true, force: true });
    fs.symlinkSync(path.join(repoRoot, 'client', 'dist'), path.join(root, 'client', 'dist'), 'dir');
  } catch (error) {
    await remove();
    throw error;
  }
  return { root, ref, commit: commit.trim(), remove };
}
