import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_URL,
  DEFAULT_PORT,
  normalizeHost,
  resolveBaseUrl,
  unreachable,
  unreachableMessage,
} from './discover.js';
import { CliError, EXIT } from './output.js';

describe('normalizeHost', () => {
  it('accepts what a person actually types', () => {
    expect(normalizeHost('bifrost.local')).toBe(`http://bifrost.local:${DEFAULT_PORT}`);
    expect(normalizeHost('192.168.1.20')).toBe(`http://192.168.1.20:${DEFAULT_PORT}`);
    expect(normalizeHost('10.0.0.5:8080')).toBe('http://10.0.0.5:8080');
    expect(normalizeHost('http://bifrost.local:4646')).toBe('http://bifrost.local:4646');
    expect(normalizeHost('  bifrost.local:4646/  ')).toBe('http://bifrost.local:4646');
  });

  it('leaves an https host on its own default port', () => {
    expect(normalizeHost('https://bridge.example')).toBe('https://bridge.example');
  });

  it('refuses what cannot be an address', () => {
    expect(() => normalizeHost('')).toThrow(CliError);
    expect(() => normalizeHost('   ')).toThrow(CliError);
    expect(() => normalizeHost('ftp://bifrost.local')).toThrow(/not an http\(s\) address/);
    expect(() => normalizeHost('http://')).toThrow(CliError);
  });
});

describe('resolveBaseUrl', () => {
  it('puts --host above the saved default, and that above bifrost.local', () => {
    expect(resolveBaseUrl('10.0.0.5', 'http://saved:4646')).toEqual({
      baseUrl: `http://10.0.0.5:${DEFAULT_PORT}`,
      source: 'flag',
    });
    expect(resolveBaseUrl(undefined, 'http://saved:4646')).toEqual({
      baseUrl: 'http://saved:4646',
      source: 'config',
    });
    expect(resolveBaseUrl(undefined, undefined)).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      source: 'default',
    });
  });

  it('treats an empty flag or empty saved host as absent', () => {
    expect(resolveBaseUrl('', '').source).toBe('default');
  });
});

describe('the unreachable path', () => {
  it('names both fixes rather than reporting a bare network error', () => {
    const message = unreachableMessage(DEFAULT_BASE_URL, 'ENOTFOUND');
    expect(message).toContain(DEFAULT_BASE_URL);
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain('--host');
    expect(message).toContain('bifrost config set-host');
  });

  it('exits with the unreachable code, not the generic failure code', () => {
    const error = unreachable(DEFAULT_BASE_URL, 'ECONNREFUSED');
    expect(error).toBeInstanceOf(CliError);
    expect(error.exitCode).toBe(EXIT.unreachable);
  });
});
