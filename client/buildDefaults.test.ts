import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENV_DEFAULTS, buildManifest, buildOf, readBuildDefaults } from './buildDefaults';

/** `KEY=value` lines of the repo-root `.env.example`. */
function envExample(): Map<string, string> {
  const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  return new Map(
    text
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
      .flatMap((match) => (match ? [[match[1] ?? '', (match[2] ?? '').trim()] as const] : [])),
  );
}

describe('build defaults', () => {
  it('match the .env.example the server documents, key for key', () => {
    const example = envExample();
    for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
      expect(example.get(key), key).toBe(value);
    }
  });

  it('fall back per key, and read what is set', () => {
    const defaults = readBuildDefaults({
      RUNESTONE_MAX_DOC_KB: '1024',
      LOKI_EXECUTION_ENABLED: 'false',
      EDDA_MAX_DOC_KB: '',
    });
    expect(defaults.caps).toEqual({
      runestoneMaxDocKb: 1024,
      eddaMaxDocKb: 2048,
      eddaLivePreviewMaxKb: 300,
      grootMaxDocKb: 2048,
      atlasMaxDocKb: 2048,
    });
    expect(defaults.loki.executionEnabled).toBe(false);
    expect(defaults.heimdall).toEqual({ shortcut: 'shift+meta+comma', tapCount: 7 });
    expect(defaults.screensaver.density).toBe('medium');
  });

  it('refuse to build on a value the server would refuse at boot', () => {
    expect(() => readBuildDefaults({ RUNESTONE_MAX_DOC_KB: '0' })).toThrow(/RUNESTONE_MAX_DOC_KB/);
    expect(() => readBuildDefaults({ ATLAS_MAX_DOC_KB: '2mb' })).toThrow(/ATLAS_MAX_DOC_KB/);
    expect(() => readBuildDefaults({ SCREENSAVER_IDLE_SECONDS: '4' })).toThrow(/5 to 3600/);
    expect(() => readBuildDefaults({ HEIMDALL_TAP_COUNT: '21' })).toThrow(/HEIMDALL_TAP_COUNT/);
    expect(() => readBuildDefaults({ SCREENSAVER_MOTION: 'wild' })).toThrow(/calm, normal, lively/);
    expect(() => readBuildDefaults({ LOKI_FETCH_ALLOWED: 'yes' })).toThrow(/true or false/);
  });

  it('records the caps by env key for the server drift check', () => {
    expect(buildManifest('hub', readBuildDefaults({ GROOT_MAX_DOC_KB: '99' }))).toEqual({
      build: 'hub',
      caps: {
        RUNESTONE_MAX_DOC_KB: 2048,
        EDDA_MAX_DOC_KB: 2048,
        EDDA_LIVE_PREVIEW_MAX_KB: 300,
        GROOT_MAX_DOC_KB: 99,
        ATLAS_MAX_DOC_KB: 2048,
      },
    });
  });

  it('is the standalone build only in standalone mode', () => {
    expect(buildOf('standalone')).toBe('standalone');
    for (const mode of ['production', 'development', 'test']) expect(buildOf(mode)).toBe('hub');
  });
});
