/**
 * Cross-tab exclusion for draft transfers and cleanup (PLAN-43).
 *
 * One IndexedDB read/write transaction over one object store is the lock: the
 * spec lets no two read/write transactions with overlapping scope run at once,
 * across every connection to the database, and both Chromium and WebKit
 * implement it so. The work runs **synchronously inside the transaction**
 * (between reading the store and writing it back), so a tab's `localStorage`
 * reads and writes there cannot interleave with another tab's.
 *
 * Why not the Web Locks API: `navigator.locks` exists only in a secure
 * context, and the hub is plain http on the LAN — the spike measured it
 * missing at `http://<LAN address>` and present only at `127.0.0.1`. IndexedDB
 * is available on both.
 *
 * The store holds what must read the same in every tab: the registry of page
 * lifetimes per tab, transfer claims and tombstones, the legacy-draft journal.
 * The spike showed a tab can read another tab's `localStorage` write a moment
 * stale right after taking the lock (2 lost updates in 3,000), so none of
 * that lives in `localStorage`.
 */

/** A synchronous view of the coordination store for the length of one transaction. */
export interface CoordTx {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  del(key: string): void;
  keys(): string[];
}

export interface CoordBackend {
  /**
   * Run `work` exclusively. Its store writes commit together when it returns;
   * if it throws, they are discarded and the promise rejects. Side effects it
   * made outside the store (`localStorage`) are not undone, so callers order
   * them to be safe on a failed commit.
   */
  run<R>(work: (tx: CoordTx) => R): Promise<R>;
}

const DB_NAME = 'bifrost-drafts';
const STORE = 'coord';

function snapshotTx(entries: Map<string, unknown>): {
  tx: CoordTx;
  writes: Map<string, { value: unknown } | null>;
} {
  const writes = new Map<string, { value: unknown } | null>();
  const tx: CoordTx = {
    get: (key) => {
      const pending = writes.get(key);
      if (pending !== undefined) return pending === null ? undefined : pending.value;
      return entries.get(key);
    },
    put: (key, value) => {
      writes.set(key, { value });
    },
    del: (key) => {
      writes.set(key, null);
    },
    keys: () => {
      const all = new Set(entries.keys());
      for (const [key, write] of writes) {
        if (write === null) all.delete(key);
        else all.add(key);
      }
      return [...all].sort();
    },
  };
  return { tx, writes };
}

/** IndexedDB, or null where the browser has none. */
export function idbBackend(): CoordBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading later (a future schema) must not be blocked by us.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new Error('indexedDB open failed'));
      };
      request.onblocked = () => {
        opening = null;
        reject(new Error('indexedDB open blocked'));
      };
    }));

  return {
    run: async <R>(work: (tx: CoordTx) => R): Promise<R> => {
      const db = await open();
      return new Promise<R>((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(STORE, 'readwrite');
        } catch (error) {
          opening = null;
          reject(error);
          return;
        }
        const store = transaction.objectStore(STORE);
        let result: R;
        let failure: unknown = null;
        const keysRequest = store.getAllKeys();
        keysRequest.onsuccess = () => {
          const valuesRequest = store.getAll();
          valuesRequest.onsuccess = () => {
            const entries = new Map<string, unknown>();
            keysRequest.result.forEach((key, index) => {
              if (typeof key === 'string') entries.set(key, valuesRequest.result[index]);
            });
            const { tx, writes } = snapshotTx(entries);
            try {
              result = work(tx);
            } catch (error) {
              failure = error;
              transaction.abort();
              return;
            }
            for (const [key, write] of writes) {
              if (write === null) store.delete(key);
              else store.put(write.value, key);
            }
          };
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(failure ?? transaction.error ?? new Error('draft coordination aborted'));
        transaction.onerror = () => {
          // onabort follows and rejects; nothing to add here.
        };
      });
    },
  };
}

/**
 * An in-memory store for tests: atomic by construction (the work is
 * synchronous), with an optional pause before each transaction so tests can
 * interleave two tabs, and a switch to make the next commits fail.
 */
export function memoryBackend(): CoordBackend & {
  entries: Map<string, unknown>;
  failNext: number;
  delay: () => Promise<void>;
} {
  const backend = {
    entries: new Map<string, unknown>(),
    failNext: 0,
    delay: () => Promise.resolve(),
    run: async <R>(work: (tx: CoordTx) => R): Promise<R> => {
      await backend.delay();
      const { tx, writes } = snapshotTx(backend.entries);
      const result = work(tx);
      if (backend.failNext > 0) {
        backend.failNext -= 1;
        throw new Error('simulated commit failure');
      }
      for (const [key, write] of writes) {
        if (write === null) backend.entries.delete(key);
        else backend.entries.set(key, write.value);
      }
      return result;
    },
  };
  return backend;
}
