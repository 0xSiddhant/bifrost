import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The hand-off wiring, checked by reading the real files (PLAN-25).
 *
 * These are source assertions rather than rendered ones on purpose. The five
 * senders are 700-line editors built on CodeMirror, and standing up a harness
 * for each would be far more machinery — and more fragile machinery — than the
 * one line per page it is checking. What that machinery could add over this is
 * covered by live-verify instead, where every button is actually pressed.
 *
 * What these *can* pin down is the part a reviewer cannot see at a glance:
 * which buffer each page sends, that two pages deliberately send nothing, and
 * that no boundary was crossed to make any of it work.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => readFileSync(path.join(SRC, relative), 'utf8');

const SENDERS = [
  ['features/runestone/RunestonePage.tsx', 'Runestone'],
  ['features/edda/EddaPage.tsx', 'Edda'],
  ['features/groot/GrootPage.tsx', 'Groot'],
  ['features/atlas/AtlasPage.tsx', 'Atlas'],
  ['features/loki/LokiPage.tsx', 'Loki'],
] as const;

describe('outbound hand-off', () => {
  it.each(SENDERS)('%s seeds Brotli and labels itself', (file, label) => {
    const source = read(file);
    expect(source).toContain("from '../../core/brotliSeed'");
    expect(source).toContain(`sourceLabel: '${label}'`);
    expect(source).toContain('onClick={compressWithBrotli}');
  });

  it.each(SENDERS)('%s disables the button on an empty buffer', (file) => {
    const source = read(file);
    const button = source.slice(source.indexOf('onClick={compressWithBrotli}') - 400);
    // Disabled, not merely inert: offering to send nothing is a false affordance.
    expect(button).toMatch(/disabled=\{(empty|text\.trim\(\) === '')\}/);
  });

  it.each(SENDERS.filter(([, label]) => label !== 'Loki'))(
    '%s sends the live buffer, never the debounced copy',
    (file) => {
      // `debouncedText` lags by 300ms, so seeding from it would hand Brotli a
      // snapshot of something the user is no longer looking at.
      expect(read(file)).toContain('putBrotliSeed({ text, sourceLabel');
    },
  );

  it('Loki sends its output pane, not its input', () => {
    const source = read('features/loki/LokiPage.tsx');
    // Loki is the one page here with two candidate buffers: `beforeSnapshot` is
    // what it was handed, `code` is what it produced. The result travels.
    expect(source).toContain('putBrotliSeed({ text: code');
    expect(source).not.toContain('putBrotliSeed({ text: beforeSnapshot');
  });

  it('offers nothing on Pensieve or Variant, which have no single buffer', () => {
    // A listing over other tools' documents, and a two-pane comparison: neither
    // has one "the content" to send. Checked by reading, not by remembering.
    for (const file of ['features/variant/VariantPage.tsx', 'app/pages/PensievePage.tsx']) {
      expect(read(file), file).not.toContain('putBrotliSeed');
    }
  });
});

describe('boundaries', () => {
  it('never imports another feature from under features/brotli', async () => {
    const dir = path.join(SRC, 'features/brotli');
    for (const name of await readdir(dir)) {
      const source = readFileSync(path.join(dir, name), 'utf8');
      // "Send to Hermes" calls POST /api/clipboard itself. Importing Hermes's
      // own client instead would be a cross-feature import — a build failure
      // under eslint-plugin-boundaries, and the exact thing that rule exists
      // to catch, so it is worth an assertion of its own too.
      expect(source, name).not.toMatch(/from '\.\.\/(?!brotli)[a-z-]+\//);
    }
  });

  it('stays out of the offline warm-load registry', () => {
    // Brotli's whole function is a server round trip: there is no client codec
    // to warm ahead of the bridge going away, so warming its chunk would only
    // buy a shell that fails on the first click (PLAN-25 acceptance 17).
    expect(read('app/offlineWarmLoad.ts')).not.toContain('brotli');
  });
});
