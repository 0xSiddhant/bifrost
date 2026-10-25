import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../testing/app.js';
import { capDrift, checkClientBuild, readClientBuild } from './client-build.js';

const scratch: string[] = [];

function distWith(manifest: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-client-dist-'));
  scratch.push(dir);
  if (manifest !== undefined) {
    fs.writeFileSync(path.join(dir, 'bifrost-build.json'), JSON.stringify(manifest));
  }
  return dir;
}

function fakeLog() {
  const log = { warn: vi.fn(), debug: vi.fn() };
  return { log, logger: log as unknown as Logger };
}

const BUILT_DEFAULTS = {
  RUNESTONE_MAX_DOC_KB: 2048,
  EDDA_MAX_DOC_KB: 2048,
  EDDA_LIVE_PREVIEW_MAX_KB: 300,
  GROOT_MAX_DOC_KB: 2048,
  ATLAS_MAX_DOC_KB: 2048,
};

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('client build cap drift (PLAN-35)', () => {
  it('finds nothing when the client baked in what the server enforces', () => {
    const manifest = readClientBuild(distWith({ build: 'hub', caps: BUILT_DEFAULTS }));
    expect(manifest && capDrift(manifest, testConfig())).toEqual([]);
  });

  it('names each key that drifted, with both numbers, in a boot warning', () => {
    const dir = distWith({ build: 'hub', caps: { ...BUILT_DEFAULTS, RUNESTONE_MAX_DOC_KB: 2048 } });
    const { log, logger } = fakeLog();
    checkClientBuild(dir, testConfig({ RUNESTONE_MAX_DOC_KB: '1024', ATLAS_MAX_DOC_KB: '4096' }), logger);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      { key: 'RUNESTONE_MAX_DOC_KB', built: 2048, enforced: 1024 },
      'client built with RUNESTONE_MAX_DOC_KB=2048, server enforces 1024 — rebuild the client',
    );
    expect(log.warn).toHaveBeenCalledWith(
      { key: 'ATLAS_MAX_DOC_KB', built: 2048, enforced: 4096 },
      expect.stringContaining('ATLAS_MAX_DOC_KB=2048'),
    );
  });

  it('warns when client/dist holds the standalone build', () => {
    const { log, logger } = fakeLog();
    checkClientBuild(distWith({ build: 'standalone', caps: BUILT_DEFAULTS }), testConfig(), logger);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ build: 'standalone' }),
      expect.stringContaining('npm run build'),
    );
  });

  it('only notes, at debug, a client with no manifest (dev mode or an older build)', () => {
    const { log, logger } = fakeLog();
    checkClientBuild(distWith(undefined), testConfig(), logger);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledOnce();
  });

  it('warns rather than crashing boot on an unreadable manifest', () => {
    const { log, logger } = fakeLog();
    checkClientBuild(distWith({ nope: true }), testConfig(), logger);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('unreadable'),
    );
  });
});
