import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configDir, configPath, deviceId, readConfig, updateConfig } from './config.js';

let home: string;
const originalPlatform = process.platform;

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-config-'));
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  setPlatform(originalPlatform);
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('path resolution', () => {
  it('is XDG-style on macOS/Linux, honouring XDG_CONFIG_HOME where it is set', () => {
    setPlatform('darwin');
    expect(configDir({ XDG_CONFIG_HOME: '/custom' }, '/Users/x')).toBe('/custom/bifrost');
    expect(configDir({}, '/Users/x')).toBe(path.join('/Users/x', '.config', 'bifrost'));

    setPlatform('linux');
    expect(configDir({}, '/home/x')).toBe(path.join('/home/x', '.config', 'bifrost'));
  });

  it('is APPDATA-rooted on Windows, falling back to the profile when it is unset', () => {
    setPlatform('win32');
    expect(configDir({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')).toBe(
      path.join('C:\\Users\\x\\AppData\\Roaming', 'bifrost'),
    );
    expect(configDir({}, 'C:\\Users\\x')).toBe(
      path.join('C:\\Users\\x', 'AppData', 'Roaming', 'bifrost'),
    );
    // XDG is not consulted on Windows even when it happens to be set.
    expect(configDir({ XDG_CONFIG_HOME: '/custom' }, 'C:\\Users\\x')).toContain('AppData');
  });

  it('names config.json inside that directory', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/custom' }, '/home/x')).toBe(
      path.join('/custom', 'bifrost', 'config.json'),
    );
  });
});

describe('reading and writing', () => {
  it('round-trips a value and merges rather than replacing', () => {
    updateConfig({ host: 'http://10.0.0.5:4646' });
    updateConfig({ deviceId: 'cli-abc' });
    expect(readConfig()).toEqual({ host: 'http://10.0.0.5:4646', deviceId: 'cli-abc' });
    expect(fs.existsSync(configPath())).toBe(true);
  });

  it('treats a missing file as the ordinary first run, silently', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(readConfig()).toEqual({});
    expect(stderr).not.toHaveBeenCalled();
  });

  it('falls back to defaults on a corrupt file, saying so once', () => {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ this is not json');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(readConfig()).toEqual({});
    expect(String(stderr.mock.calls[0]?.[0])).toContain('not valid JSON');
  });

  it('falls back to defaults when the file holds a non-object', () => {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '["a list"]');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(readConfig()).toEqual({});
  });

  it('warns but does not throw when the config cannot be written', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EROFS: read-only file system');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => updateConfig({ host: 'http://x:1' })).not.toThrow();
    expect(String(stderr.mock.calls[0]?.[0])).toContain('EROFS');
  });
});

describe('deviceId', () => {
  it('mints one on first use and reuses it afterwards', () => {
    const first = deviceId();
    expect(first).toMatch(/^cli-/);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(deviceId()).toBe(first);
  });
});
