import fsp from 'node:fs/promises';
import path from 'node:path';
import { FolderConflictError, type FolderPlacement, type FolderPublisher } from '../ports.js';
import { placeFile } from './place-file.js';

/**
 * A folder upload writes straight into downloads/<folder>/ (PLAN-24) — no
 * uploads/ staging, no Move step. It reuses the module's existing write
 * discipline unchanged: the bytes are already complete in a tmp file, and
 * `placeFile` hard-links them under a free name, so there is no window in
 * which a truncated or zero-byte file is visible.
 *
 * The one thing a crash can leave behind is an **empty folder** — a directory
 * a person can delete in Finder, not a corrupt file — so this needs no boot
 * reconciliation of its own, unlike the link-then-unlink move.
 */
export class FsFolderPublisher implements FolderPublisher {
  constructor(private readonly downloadsDir: string) {}

  async publish(tmpPath: string, folder: string, desiredName: string): Promise<FolderPlacement> {
    try {
      const dir = await this.ensureFolder(folder);
      const { finalName } = await placeFile(dir, tmpPath, desiredName);
      // The link inherits the tmp file's private 0600; downloads are 0644.
      await fsp.chmod(path.join(dir, finalName), 0o644);
      return { finalName, folder };
    } finally {
      // Either the bytes are linked into the folder or the upload failed;
      // the tmp copy has done its job either way (FsFileStorageRepository
      // discards on the success path for the same reason).
      await fsp.rm(tmpPath, { force: true });
    }
  }

  /**
   * `mkdir` answers EEXIST for two different worlds, and one `stat` separates
   * them: a directory is reused (that is the whole "append, never duplicate"
   * rule), anything else is a real conflict.
   *
   * This also settles the concurrent-create race for free — two devices
   * sending into the same brand-new folder name race the mkdir, one wins and
   * one gets EEXIST, and the loser's stat finds the directory the winner just
   * made. Neither has to know which one it was.
   */
  private async ensureFolder(folder: string): Promise<string> {
    const dir = path.join(this.downloadsDir, folder);
    try {
      await fsp.mkdir(dir, { recursive: false });
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) {
      throw new FolderConflictError(`"${folder}" is already a file, not a folder`);
    }
    return dir;
  }
}
