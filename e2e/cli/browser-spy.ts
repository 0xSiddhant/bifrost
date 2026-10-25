import fs from 'node:fs';
import path from 'node:path';

/**
 * A stand-in for "the browser": `xdg-open` and `open` executables (plus
 * `$BROWSER`, which the `open` package's bundled xdg-open script consults) that
 * only append their arguments to a log. Put first on PATH, they let a test
 * prove a browser was — or was not — launched, without launching one.
 */
export interface BrowserSpy {
  env: Record<string, string>;
  launches(): string[];
  /** Wait briefly: the launcher is spawned detached and may land after exit. */
  waitForLaunch(timeoutMs?: number): Promise<string[]>;
}

export function browserSpy(home: string, baseEnv: Record<string, string>): BrowserSpy {
  const bin = path.join(home, 'spy-bin');
  const log = path.join(home, 'browser-launches.log');
  fs.mkdirSync(bin, { recursive: true });
  const script = `#!/bin/sh\necho "$@" >> "${log}"\n`;
  for (const name of ['xdg-open', 'open', 'spy-browser']) {
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
  const launches = () =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return {
    env: {
      ...baseEnv,
      PATH: `${bin}${path.delimiter}${baseEnv.PATH ?? ''}`,
      BROWSER: path.join(bin, 'spy-browser'),
    },
    launches,
    async waitForLaunch(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && launches().length === 0)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return launches();
    },
  };
}
