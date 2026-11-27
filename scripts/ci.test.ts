// CI's browser jobs run in Microsoft's Playwright image, which carries the
// browser builds of exactly one Playwright release. A bump of @playwright/test
// without the image tag would look for browsers the image does not have.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** ci.yml without its comment lines: only what runs. */
const workflow = () =>
  read('.github', 'workflows', 'ci.yml')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

/** Each job's id and its own block of lines. */
function jobs(): Map<string, string> {
  const text = workflow();
  const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const found = new Map<string, string>();
  for (const block of body.split(/\n(?= {2}[a-z0-9-]+:\n)/)) {
    const id = /^ {2}([a-z0-9-]+):/.exec(block)?.[1];
    if (id) found.set(id, block);
  }
  return found;
}

/** What scripts/ci-changes.sh says for these changed files. */
function classify(files: string[]): string {
  const run = spawnSync('sh', [path.join(ROOT, 'scripts', 'ci-changes.sh')], {
    input: files.join('\n'),
    encoding: 'utf8',
  });
  expect(run.status).toBe(0);
  return run.stdout.trim();
}

describe('CI', () => {
  it("runs the browser jobs in the Playwright image of e2e's own Playwright version", () => {
    const ci = read('.github', 'workflows', 'ci.yml');
    const tags = [...ci.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s-]+)-/g)].map((m) => m[1]);
    const e2e = JSON.parse(read('e2e', 'package.json')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const pinned =
      e2e.devDependencies?.['@playwright/test'] ?? e2e.dependencies?.['@playwright/test'];

    expect(tags.length).toBeGreaterThan(0);
    // An exact pin, so "the version" means one thing on both sides.
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(tags)).toEqual(new Set([pinned]));
  });

  it('installs no browser system libraries from apt in CI', () => {
    // Comments may say why it is gone; only a command would bring it back.
    expect(workflow()).not.toMatch(/playwright install-deps|install --with-deps/);
  });

  it('runs no WebKit journeys: they run by hand (owner, 2026-11-27)', () => {
    expect(workflow()).not.toMatch(/webkit/i);
  });

  it('skips every job but `changes` only on its explicit documentation-only verdict', () => {
    // A skipped job reads as passed, so anything short of `code=false` (no
    // output at all, or `changes` failing) must run the job, not skip it.
    const all = jobs();
    expect(all.has('changes')).toBe(true);
    for (const [id, block] of all) {
      if (id === 'changes') continue;
      expect(block, id).toMatch(/\n {4}needs: changes\n/);
      expect(block, id).toMatch(
        /\n {4}if: \$\{\{ !cancelled\(\) && needs\.changes\.outputs\.code != 'false' \}\}\n/,
      );
    }
  });

  it("lists a renamed file's old path too, so moving code into docs/ still runs", () => {
    // The API lists a rename under its new path alone, with the old one in
    // `previous_filename`.
    const changes = jobs().get('changes') ?? '';
    expect(changes).toContain(`paths='.filename, (.previous_filename // empty)'`);
    const queries = [...changes.matchAll(/gh api .* --jq "([^"]+)"/g)].map((m) => m[1]);
    expect(queries).toEqual(['.[] | $paths', '.files[] | $paths']);
  });

  it("runs every workspace's unit tests, and scripts/, across the unit jobs", () => {
    const unit = jobs().get('unit') ?? '';
    const listed = [...unit.matchAll(/workspaces: ([a-z0-9 ]+)/g)].flatMap((m) =>
      (m[1] ?? '').split(' '),
    );
    const root = JSON.parse(read('package.json')) as { workspaces: string[] };
    const tested = root.workspaces.filter(
      (ws) =>
        (JSON.parse(read(ws, 'package.json')) as { scripts?: Record<string, string> }).scripts
          ?.test,
    );
    expect([...listed].sort()).toEqual([...tested].sort());
    expect(unit).toMatch(/vitest run --dir scripts/);
  });
});

describe('ci-changes.sh', () => {
  it('skips a change to documentation only', () => {
    expect(
      classify([
        'README.md',
        'CLAUDE.md',
        '.agents/memory/progress.md',
        '.claude/skills/verify/SKILL.md',
        'docs/testing.md',
        'docs/assets/hub.png',
        'example/README.md',
        '.github/copilot-instructions.md',
        'LICENSE',
      ]),
    ).toBe('code=false');
  });

  it('runs for any code, config or workflow file among them', () => {
    for (const file of [
      'server/src/app.ts',
      '.github/workflows/ci.yml',
      'package-lock.json',
      '.env.example',
    ]) {
      expect(classify(['README.md', file]), file).toBe('code=true');
    }
  });

  it('runs for Markdown the code uses: the Guide pages and the man page', () => {
    expect(classify(['client/src/assets/guides/json.md'])).toBe('code=true');
    expect(classify(['cli/man/bifrost.1.md'])).toBe('code=true');
  });

  it('runs everything when the list of files could not be had', () => {
    expect(classify([])).toBe('code=true');
  });
});
