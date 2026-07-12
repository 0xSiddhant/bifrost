import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { rollOptions } from './index.js';

describe('rollOptions', () => {
  it('rolls daily with a 20MB cap and a stable symlink for tailing', () => {
    const options = rollOptions('/var/bifrost/storage/logs');
    expect(options.file).toBe(path.join('/var/bifrost/storage/logs', 'app'));
    expect(options.extension).toBe('.log');
    expect(options.frequency).toBe('daily');
    expect(options.size).toBe('20m');
    expect(options.symlink).toBe(true);
    expect(options.mkdir).toBe(true);
  });
});
