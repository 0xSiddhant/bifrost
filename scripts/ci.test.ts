// CI's browser jobs run in Microsoft's Playwright image, which carries the
// browser builds of exactly one Playwright release. A bump of @playwright/test
// without the image tag would look for browsers the image does not have.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

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
    const commands = read('.github', 'workflows', 'ci.yml')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(commands).not.toMatch(/playwright install-deps|install --with-deps/);
  });
});
