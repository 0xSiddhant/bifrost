/**
 * `npm run test:api-diff -- --base <ref> [--candidate <ref>] [--data <app.db>]`
 *
 * Old-vs-new, byte for byte, on the same data (PLAN-32a):
 *   1. build <ref>'s server in a temporary git worktree (and --candidate's, if
 *      given; otherwise the candidate is this checkout's own `npm run build`);
 *   2. seed one scratch storage through the base build's API — or, with
 *      --data, snapshot that database with VACUUM INTO (read-only on the source)
 *      and run reads only;
 *   3. copy that storage twice, file timestamps preserved;
 *   4. start base, then candidate — one at a time, on the same port, with the
 *      same session secret, so nothing but the code differs between them;
 *   5. replay the read corpus (and, without --data, one scripted write
 *      sequence) against each, and compare status, headers and body bytes.
 *
 * Every worktree, scratch storage and snapshot is deleted before it exits,
 * pass or fail. Exit 0: no unexpected difference. Exit 1: differences (listed).
 * Exit 2: the tool could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Api } from '../support/api.js';
import { freePort } from '../support/free-port.js';
import { REPO_ROOT } from '../support/paths.js';
import { E2E_PIN, startServer, type E2EServer } from '../support/server.js';
import { compareRuns, type Captured, type Difference } from './compare.js';
import { discoverCorpus, EXCLUDED, replay, type ReadRequest } from './corpus.js';
import { readSpec, uncoveredReads } from './corpus-check.js';
import { EXPECTED_DIFFERENCES } from './expected-differences.js';
import { seed, settle, type Seeded } from './seed.js';
import {
  buildWorktree,
  copyPreservingTimes,
  rowCounts,
  scratch,
  snapshotDatabase,
  type Worktree,
} from './storage.js';
import { runWrites } from './writes.js';

const log = (line: string) => process.stdout.write(`${line}\n`);

/** One fixed secret, so the admin session minted while seeding is valid on both sides. */
const SESSION_SECRET = 'e2e-api-diff-session-secret-0123456789abcdef';
const ENV = { HEIMDALL_SESSION_SECRET: SESSION_SECRET };

interface Side {
  label: string;
  buildRoot: string;
}

interface SideResult {
  reads: Captured[];
  writes: Captured[];
}

async function runSide(
  side: Side,
  storageRoot: string,
  themesDir: string,
  port: number,
  cookie: string,
  corpus: ReadRequest[] | null,
  writes: boolean,
): Promise<SideResult & { corpus: ReadRequest[] }> {
  log(`▸ ${side.label}: starting on port ${port}`);
  const server: E2EServer = await startServer({
    buildRoot: side.buildRoot,
    storageRoot,
    themesDir,
    port,
    env: ENV,
    keepStorage: true,
  });
  try {
    const api = new Api(server.baseUrl, 'diff-reader');
    const admin = new Api(server.baseUrl, 'diff-reader');
    admin.cookie = cookie;
    const requests = corpus ?? (await discoverCorpus(api, seededState));
    log(`  replaying ${requests.length} reads…`);
    const reads = await replay(api, admin, requests);
    const written = writes ? await runWrites(server.baseUrl, admin) : [];
    if (writes) log(`  ran ${written.length} write-sequence requests`);
    return { corpus: requests, reads, writes: written };
  } finally {
    await server.stop();
  }
}

let seededState: Seeded | null = null;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { base: { type: 'string' }, candidate: { type: 'string' }, data: { type: 'string' } },
  });
  if (!values.base) {
    log(
      'usage: npm run test:api-diff -- --base <ref> [--candidate <ref>] [--data <path/to/app.db>]',
    );
    return 2;
  }
  const readsOnly = values.data !== undefined;
  const cleanup: (() => Promise<void> | void)[] = [];
  const worktrees: Worktree[] = [];
  try {
    log(`▸ building base ${values.base}`);
    const baseTree = await buildWorktree(REPO_ROOT, values.base, log);
    worktrees.push(baseTree);
    cleanup.push(() => baseTree.remove());
    let candidate: Side = { label: 'candidate (this checkout)', buildRoot: REPO_ROOT };
    if (values.candidate) {
      log(`▸ building candidate ${values.candidate}`);
      const candidateTree = await buildWorktree(REPO_ROOT, values.candidate, log);
      worktrees.push(candidateTree);
      cleanup.push(() => candidateTree.remove());
      candidate = {
        label: `candidate ${values.candidate} (${candidateTree.commit})`,
        buildRoot: candidateTree.root,
      };
    } else if (!fs.existsSync(path.join(REPO_ROOT, 'server', 'dist', 'bootstrap.js'))) {
      log('no build in this checkout — run `npm run build` first, or pass --candidate <ref>');
      return 2;
    }
    const base: Side = {
      label: `base ${values.base} (${baseTree.commit})`,
      buildRoot: baseTree.root,
    };

    // One seeded storage, written once through the base build.
    const seedRoot = scratch('bifrost-api-diff-seed-');
    const seedThemes = scratch('bifrost-api-diff-themes-');
    cleanup.push(() => fs.rmSync(seedRoot, { recursive: true, force: true }));
    cleanup.push(() => fs.rmSync(seedThemes, { recursive: true, force: true }));
    fs.cpSync(path.join(baseTree.root, 'themes'), seedThemes, { recursive: true });
    if (values.data) {
      const source = path.resolve(values.data);
      log(`▸ snapshotting ${source} (VACUUM INTO, read-only on the source)`);
      snapshotDatabase(source, path.join(seedRoot, 'data', 'app.db'));
      log(`  rows: ${JSON.stringify(rowCounts(path.join(seedRoot, 'data', 'app.db')))}`);
    }
    log(
      readsOnly
        ? '▸ opening an admin session on the snapshot (base build)'
        : '▸ seeding through the base build',
    );
    const seedServer = await startServer({
      buildRoot: base.buildRoot,
      storageRoot: seedRoot,
      themesDir: seedThemes,
      env: ENV,
      keepStorage: true,
    });
    let cookie: string;
    try {
      const admin = await new Api(seedServer.baseUrl).login(E2E_PIN);
      cookie = admin.cookie ?? '';
      if (!readsOnly) {
        seededState = await seed(seedServer.baseUrl, admin);
        await settle(seedServer.baseUrl);
      }
    } finally {
      await seedServer.stop();
    }

    // Copied twice, timestamps and all; the source (and any snapshot) goes now.
    const sides = {
      base: scratch('bifrost-api-diff-base-'),
      candidate: scratch('bifrost-api-diff-candidate-'),
    };
    const themes = {
      base: scratch('bifrost-api-diff-base-themes-'),
      candidate: scratch('bifrost-api-diff-cand-themes-'),
    };
    for (const dir of [...Object.values(sides), ...Object.values(themes)])
      cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const key of ['base', 'candidate'] as const) {
      fs.rmSync(sides[key], { recursive: true, force: true });
      fs.rmSync(themes[key], { recursive: true, force: true });
      copyPreservingTimes(seedRoot, sides[key]);
      copyPreservingTimes(seedThemes, themes[key]);
    }
    fs.rmSync(seedRoot, { recursive: true, force: true });

    const port = await freePort();
    const baseRun = await runSide(base, sides.base, themes.base, port, cookie, null, !readsOnly);
    const candidateRun = await runSide(
      candidate,
      sides.candidate,
      themes.candidate,
      port,
      cookie,
      baseRun.corpus,
      !readsOnly,
    );

    // Seeded runs only: the seed is built to reach every read route, while a
    // snapshot of someone's data may simply hold no folder or no go-link.
    if (!readsOnly) {
      const spec = readSpec(path.join(candidate.buildRoot, 'server', 'openapi.json'));
      if (spec) {
        const gaps = uncoveredReads(
          spec,
          baseRun.corpus.map((request) => request.path),
          EXCLUDED.map((entry) => entry.path.replace(/:(\w+)/g, '{$1}')),
        );
        if (gaps.length > 0) {
          log(`✗ the corpus never reads ${gaps.length} GET route(s) in openapi.json:`);
          for (const gap of gaps) log(`  - GET ${gap}`);
          return 1;
        }
        log('  corpus check: every GET in openapi.json is read or excluded');
      } else {
        log('  corpus check skipped: the candidate has no server/openapi.json');
      }
    }

    const all = [
      ...compareRuns(baseRun.reads, candidateRun.reads),
      ...compareRuns(baseRun.writes, candidateRun.writes),
    ];
    const unexpected: Difference[] = [];
    const expected: Difference[] = [];
    for (const difference of all) {
      (EXPECTED_DIFFERENCES.some((entry) => entry.matches(difference))
        ? expected
        : unexpected
      ).push(difference);
    }

    log('');
    log(
      `compared ${baseRun.reads.length} reads${readsOnly ? ' (reads only: --data)' : ` and ${baseRun.writes.length} write-sequence responses`}`,
    );
    log(`excluded by nature: ${EXCLUDED.map((entry) => entry.path).join(', ')}`);
    if (expected.length > 0) log(`expected differences: ${expected.length}`);
    if (unexpected.length === 0) {
      log('✓ zero unexpected differences');
      return 0;
    }
    log(`✗ ${unexpected.length} unexpected difference(s):`);
    for (const difference of unexpected.slice(0, 200))
      log(`  - ${difference.request} [${difference.what}] ${difference.detail}`);
    return 1;
  } finally {
    for (const step of cleanup.reverse()) await step();
    log(
      `cleaned up: ${worktrees.length} worktree(s) and every scratch storage${values.data ? ', including the snapshot' : ''}`,
    );
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `api-diff could not run: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(2);
  },
);
