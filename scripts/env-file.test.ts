// .env housekeeping, on temporary files only: never the repo's own .env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dropLauncherKeys, pinIsSet, updateMovedDefaults, writePin } from './env-file.js';

function envFile(content: string, mode = 0o600): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-env-')), '.env');
  fs.writeFileSync(file, content, { mode });
  return file;
}

describe('.env housekeeping', () => {
  it('removes active launcher-key lines only, keeping comments, order and permissions', () => {
    const file = envFile(
      '# BIFROST_RUN=full is a comment\nPORT=4646\nOTEL_ENABLED=false\nMDNS_NAME=bifrost\nBIFROST_RUN=api\n',
    );
    expect(dropLauncherKeys(file)).toEqual(['OTEL_ENABLED=false', 'BIFROST_RUN=api']);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '# BIFROST_RUN=full is a comment\nPORT=4646\nMDNS_NAME=bifrost\n',
    );
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(dropLauncherKeys(file)).toEqual([]);
  });

  it('sets the PIN on its existing line, or adds one', () => {
    const existing = envFile('PORT=4646\nHEIMDALL_PIN=\nMDNS_NAME=bifrost\n');
    expect(pinIsSet(existing)).toBe(false);
    writePin(existing, 'a$1&b');
    expect(fs.readFileSync(existing, 'utf8')).toBe(
      'PORT=4646\nHEIMDALL_PIN=a$1&b\nMDNS_NAME=bifrost\n',
    );
    expect(pinIsSet(existing)).toBe(true);

    const none = envFile('PORT=4646');
    writePin(none, '1234');
    expect(fs.readFileSync(none, 'utf8')).toBe('PORT=4646\nHEIMDALL_PIN=1234\n');
  });

  it('refuses a PIN the server would refuse', () => {
    const file = envFile('HEIMDALL_PIN=\n');
    expect(() => writePin(file, '123')).toThrow();
    expect(() => writePin(file, '12\n34')).toThrow();
    expect(pinIsSet(file)).toBe(false);
  });

  it('moves an old default that moved, and leaves a chosen value alone', () => {
    const old = envFile('PORT=4646\nOTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\nX=1\n');
    expect(updateMovedDefaults(old)).toEqual([
      expect.stringContaining('http://localhost:4318 → http://localhost:4650'),
    ]);
    expect(fs.readFileSync(old, 'utf8')).toBe(
      'PORT=4646\nOTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4650\nX=1\n',
    );
    expect(updateMovedDefaults(old)).toEqual([]);

    const chosen = envFile('OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.lan:4318\n');
    expect(updateMovedDefaults(chosen)).toEqual([]);
    expect(fs.readFileSync(chosen, 'utf8')).toBe(
      'OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.lan:4318\n',
    );
  });
});
