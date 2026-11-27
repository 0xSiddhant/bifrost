export class DownloadFolderLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(folder: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(folder) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(folder, tail);
    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(folder) === tail) this.tails.delete(folder);
    }
  }
}
