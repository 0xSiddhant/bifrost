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
    expect(config.logLevel).toBe('info');
    expect(config.backupDir).toBeNull();
    expect(config.runestone.maxDocKb).toBe(2048);
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

  it('applies a persisted log level (Heimdall runtime switch survives restart)', () => {
    expect(applySettingsOverlay(base, [{ key: 'log.level', value: 'debug' }]).logLevel).toBe('debug');
    // a bad value is ignored, leaving the .env default
    expect(applySettingsOverlay(base, [{ key: 'log.level', value: 'loud' }]).logLevel).toBe(base.logLevel);
  });
});
