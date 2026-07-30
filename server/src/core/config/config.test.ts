import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { applySettingsOverlay, ConfigError, loadConfig } from './index.js';

const VALID_ENV = { HEIMDALL_PIN: '4321' };

describe('loadConfig', () => {
  it('applies documented defaults over a minimal env', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.profile).toBe('local');
    expect(config.port).toBe(4646);
    expect(config.mdnsName).toBe('bifrost');
    expect(config.maxUploadSizeMb).toBe(2048);
    expect(config.maxFilesPerUpload).toBe(20);
    expect(config.heimdall.shortcut).toBe('shift+meta+comma');
    expect(config.heimdall.tapCount).toBe(7);
    // trace, not info: the file is a pure archive feeding Loki now, so the
    // level is filtered at query time rather than discarded at write time.
    expect(config.logLevel).toBe('trace');
    expect(config.logRetentionFiles).toBe(30);
    // The client does NOT follow the server down to trace — every browser line
    // crosses the network into an unauthenticated endpoint.
    expect(config.clientLogs.level).toBe('warn');
    expect(config.clientLogs.maxBatch).toBe(50);
    expect(config.clientLogs.maxBodyBytes).toBe(64 * 1024);
    expect(config.backupDir).toBeNull();
    expect(config.runestone.maxDocKb).toBe(2048);
  });

  it('reads LOG_RETENTION_FILES and the client-log bounds', () => {
    const config = loadConfig({
      ...VALID_ENV,
      LOG_RETENTION_FILES: '7',
      CLIENT_LOG_LEVEL: 'debug',
      CLIENT_LOG_MAX_BODY_KB: '8',
      CLIENT_LOG_RATE_LIMIT_PER_MIN: '5',
    });
    expect(config.logRetentionFiles).toBe(7);
    expect(config.clientLogs.level).toBe('debug');
    expect(config.clientLogs.maxBodyBytes).toBe(8 * 1024);
    expect(config.clientLogs.rateLimitPerMin).toBe(5);
  });

  it('reads RUNESTONE_MAX_DOC_KB', () => {
    const config = loadConfig({ ...VALID_ENV, RUNESTONE_MAX_DOC_KB: '512' });
    expect(config.runestone.maxDocKb).toBe(512);
  });

  it('fails fast when HEIMDALL_PIN is missing, naming the key', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);
    expect(() => loadConfig({})).toThrowError(/HEIMDALL_PIN/);
  });

  it('lists every invalid key in one error', () => {
    const attempt = () =>
      loadConfig({ ...VALID_ENV, PORT: 'not-a-number', LOG_LEVEL: 'loud', DEPLOY_PROFILE: 'moon' });
    expect(attempt).toThrowError(/PORT/);
    expect(attempt).toThrowError(/LOG_LEVEL/);
    expect(attempt).toThrowError(/DEPLOY_PROFILE/);
  });

  it('treats empty strings as unset (falls back to defaults)', () => {
    const config = loadConfig({ ...VALID_ENV, PORT: '', BACKUP_DIR: '', MDNS_NAME: '' });
    expect(config.port).toBe(4646);
    expect(config.mdnsName).toBe('bifrost');
    expect(config.backupDir).toBeNull();
  });

  it('parses the extension blocklist into normalized entries', () => {
    const config = loadConfig({ ...VALID_ENV, UPLOAD_EXT_BLOCKLIST: '.EXE, .bat ,,.Sh' });
    expect(config.uploadExtBlocklist).toEqual(['.exe', '.bat', '.sh']);
  });

  it('resolves relative STORAGE_ROOT against the repo root, not cwd', () => {
    const config = loadConfig(VALID_ENV);
    expect(path.isAbsolute(config.storage.root)).toBe(true);
    expect(config.storage.dbFile).toBe(path.join(config.storage.root, 'data', 'app.db'));
  });

  it('returns a frozen config', () => {
    const config = loadConfig(VALID_ENV);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.heimdall)).toBe(true);
  });
});

describe('applySettingsOverlay', () => {
  const base = loadConfig(VALID_ENV);

  it('DB settings win over .env defaults for overlayable keys', () => {
    const overlaid = applySettingsOverlay(base, [
      { key: 'heimdall.shortcut', value: 'ctrl+alt+h' },
      { key: 'heimdall.tapCount', value: '5' },
    ]);
    expect(overlaid.heimdall.shortcut).toBe('ctrl+alt+h');
    expect(overlaid.heimdall.tapCount).toBe(5);
  });

  it('does not mutate the base config', () => {
    applySettingsOverlay(base, [{ key: 'heimdall.shortcut', value: 'ctrl+alt+h' }]);
    expect(base.heimdall.shortcut).toBe('shift+meta+comma');
  });

  it('ignores unknown keys and invalid values', () => {
    const overlaid = applySettingsOverlay(base, [
      { key: 'nonsense.key', value: 'x' },
      { key: 'heimdall.tapCount', value: 'ninety-nine' },
    ]);
    expect(overlaid.heimdall.tapCount).toBe(7);
  });

  // PLAN-16a: Heimdall's runtime level switch is gone and LOG_LEVEL in .env is
  // authoritative. Migration 0009 deletes the row, but a DB restored from an
  // old backup can still carry one — it must be ignored, not obeyed, or the
  // install stays stuck at a level nobody can change any more.
  it('ignores a legacy persisted log.level row', () => {
    expect(applySettingsOverlay(base, [{ key: 'log.level', value: 'debug' }]).logLevel).toBe(
      base.logLevel,
    );
  });
});
