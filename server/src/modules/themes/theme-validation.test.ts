import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ThemeValidator } from './services/theme-validator.js';
import { ThemeValidationError } from './ports.js';
import { resolveTheme } from './resolve.js';
import { contrastRatio, contrastWarnings } from './contrast.js';

const validator = new ThemeValidator();

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function minimalTheme(overrides: Record<string, unknown> = {}) {
  return {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    tokens: {
      '--bg': '#0a0a12',
      '--surface': '#12121f',
      '--surface-2': '#1a1a2c',
      '--text': '#ececf5',
      '--text-muted': '#8a8fa5',
      '--border': '#26263c',
      '--accent': '#5eead4',
      '--accent-2': '#a78bfa',
      '--ok': '#4ade80',
      '--danger': '#f87171',
      '--warn': '#fbbf24',
      '--accent-soft': 'rgba(94, 234, 212, 0.12)',
      '--danger-soft': 'rgba(248, 113, 113, 0.12)',
      '--scrim': 'rgba(0, 0, 0, 0.7)',
    },
    ...overrides,
  };
}

describe('theme schema validation', () => {
  it('accepts the committed built-ins verbatim', () => {
    for (const file of ['themes/aurora.json', 'themes/daybreak.json']) {
      const raw = fs.readFileSync(`${REPO_ROOT}/${file}`, 'utf8');
      expect(() => validator.parse(raw)).not.toThrow();
    }
  });

  it('accepts a minimal 14-color theme', () => {
    expect(() => validator.check(minimalTheme())).not.toThrow();
  });

  it('reports the exact path of a missing color role', () => {
    const theme = minimalTheme();
    delete (theme.tokens as Record<string, string>)['--accent'];
    try {
      validator.check(theme);
      expect.unreachable('should have thrown');
    } catch (error) {
      const issues = (error as ThemeValidationError).issues;
      expect(issues.some((issue) => issue.message.includes('--accent'))).toBe(true);
      expect(issues[0]?.path).toContain('/tokens');
    }
  });

  it('collects ALL errors, not just the first', () => {
    const theme = minimalTheme({ mode: 'dusk', id: 'NOT VALID' });
    try {
      validator.check(theme);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ThemeValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects unknown token keys', () => {
    const theme = minimalTheme();
    (theme.tokens as Record<string, string>)['--evil'] = '#fff';
    expect(() => validator.check(theme)).toThrow(ThemeValidationError);
  });

  it('rejects url() smuggled into css values (offline-first, no callouts)', () => {
    const theme = minimalTheme();
    (theme.tokens as Record<string, string>)['--sky'] = 'url(https://evil.example/x.png)';
    expect(() => validator.check(theme)).toThrow(ThemeValidationError);
  });

  it('rejects non-self-hosted fonts', () => {
    const theme = minimalTheme();
    (theme.tokens as Record<string, string>)['--font-body'] = "'Comic Sans MS', cursive";
    expect(() => validator.check(theme)).toThrow(ThemeValidationError);
  });

  it('rejects malformed JSON with a readable issue', () => {
    try {
      validator.parse('{ not json');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ThemeValidationError).issues[0]?.message).toContain('not valid JSON');
    }
  });
});

describe('resolveTheme derived defaults', () => {
  it('fills syntax, qr, and atmosphere tokens for a minimal theme', () => {
    const resolved = resolveTheme(validator.check(minimalTheme()), false);
    expect(resolved.tokens['--syn-key']).toBe('#5eead4'); // accent
    expect(resolved.tokens['--syn-string']).toBe('#4ade80'); // ok
    expect(resolved.tokens['--bridge']).toContain('#5eead4');
    expect(resolved.tokens['--sky']).toContain('radial-gradient');
    expect(resolved.tokens['--qr-bg']).toBe('#eef1fa'); // dark-mode default
    expect(resolved.tokens['--stars-alpha']).toBe('1');
    expect(resolved.preview).toEqual({ bg: '#0a0a12', accent: '#5eead4' });
  });

  it('never overrides authored values', () => {
    const theme = minimalTheme();
    (theme.tokens as Record<string, string>)['--syn-key'] = '#ff0000';
    const resolved = resolveTheme(validator.check(theme), false);
    expect(resolved.tokens['--syn-key']).toBe('#ff0000');
  });

  it('derives light-mode variants for light themes', () => {
    const theme = minimalTheme({ mode: 'light' });
    const resolved = resolveTheme(validator.check(theme), false);
    expect(resolved.tokens['--stars']).toBe('transparent');
    expect(resolved.tokens['--stars-alpha']).toBe('0');
    expect(resolved.tokens['--qr-bg']).toBe('#ffffff');
  });
});

describe('contrast lint', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 1);
  });

  it('warns when text on bg is below 4.5:1 but never blocks', () => {
    const warnings = contrastWarnings({ '--text': '#777777', '--bg': '#666666' });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('--text');
  });

  it('is silent for the built-ins', () => {
    const raw = fs.readFileSync(`${REPO_ROOT}/themes/aurora.json`, 'utf8');
    const resolved = resolveTheme(validator.parse(raw), true);
    expect(resolved.warnings).toEqual([]);
  });
});
