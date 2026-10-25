import { describe, expect, it } from 'vitest';
import { envKeysFrom, knownEnvKeys, serverEnv } from './env.js';

describe('envKeysFrom', () => {
  it('reads assignments and ignores comments, blanks and lower-case names', () => {
    const text =
      '# PORT=1\nPORT=4646\n\n  MDNS_NAME = bifrost\nexport LOG_LEVEL=trace\nnot_a_key=1\n';
    expect(envKeysFrom(text)).toEqual(['PORT', 'MDNS_NAME', 'LOG_LEVEL']);
  });
});

describe('knownEnvKeys', () => {
  it('includes every required key from .env.example', () => {
    const keys = knownEnvKeys();
    for (const key of ['DEPLOY_PROFILE', 'PORT', 'STORAGE_ROOT', 'HEIMDALL_PIN']) {
      expect(keys).toContain(key);
    }
  });
});

describe('serverEnv', () => {
  it('blanks a developer value the overrides do not name, so the default applies', () => {
    const env = serverEnv({ PORT: '5000' }, { PATH: '/bin', LOG_LEVEL: 'error', PORT: '1' }, [
      'LOG_LEVEL',
      'PORT',
    ]);
    expect(env).toEqual({ PATH: '/bin', LOG_LEVEL: '', PORT: '5000' });
  });
});
