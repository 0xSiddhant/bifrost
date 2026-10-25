// .env housekeeping for setup and start, so nobody edits .env by hand to run
// Bifrost (owner, 2026-10-09):
//   - the launcher keys (BIFROST_RUN, MDNS_ADVERTISER, OTEL_ENABLED) are the
//     launcher's flags now and ignored in .env, so a line left behind is
//     removed rather than warned about on every boot;
//   - a missing HEIMDALL_PIN is asked for once, on a terminal. It stays in
//     .env, never in a Dockerfile or an image: it is a secret.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { LAUNCHER_KEYS } from '../server/src/core/config/dotenv.js';

const PIN_MIN = 4; // HEIMDALL_PIN's own rule (server/src/core/config/index.ts)

/** Rewrite the file in place, keeping its permissions. */
function rewrite(file: string, content: string): void {
  const mode = fs.statSync(file).mode & 0o777;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, file);
}

/** Remove active launcher-key lines from .env; returns the lines removed. */
export function dropLauncherKeys(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const pattern = new RegExp(`^(${LAUNCHER_KEYS.join('|')})=`);
  const removed = lines.filter((line) => pattern.test(line));
  if (removed.length > 0) rewrite(file, lines.filter((line) => !pattern.test(line)).join('\n'));
  return removed;
}

/**
 * Values that were the shipped default and moved since: a line still holding
 * the old default is updated, so .env follows the stack without hand edits. A
 * value someone chose is never touched.
 */
const MOVED_DEFAULTS: Array<{ key: string; from: string; to: string; why: string }> = [
  {
    key: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    from: 'http://localhost:4318',
    to: 'http://localhost:4650',
    why: "Tempo's intake moved to 4650, after Bifrost's own ports",
  },
];

/** Update lines still holding a moved default; returns one message per change. */
export function updateMovedDefaults(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  let content = fs.readFileSync(file, 'utf8');
  const changed: string[] = [];
  for (const { key, from, to, why } of MOVED_DEFAULTS) {
    const line = new RegExp(`^${key}=${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`, 'm');
    if (line.test(content)) {
      content = content.replace(line, () => `${key}=${to}`);
      changed.push(`${key} ${from} → ${to} (${why})`);
    }
  }
  if (changed.length > 0) rewrite(file, content);
  return changed;
}

export function pinIsSet(file: string): boolean {
  return (
    fs.existsSync(file) &&
    new RegExp(`^HEIMDALL_PIN=.{${PIN_MIN},}`, 'm').test(fs.readFileSync(file, 'utf8'))
  );
}

/** Set HEIMDALL_PIN in .env: the existing line, or a new one at the end. */
export function writePin(file: string, pin: string): void {
  if (pin.length < PIN_MIN || /[\r\n]/.test(pin))
    throw new Error(`the PIN needs ${PIN_MIN}+ characters on one line`);
  const content = fs.readFileSync(file, 'utf8');
  const line = `HEIMDALL_PIN=${pin}`;
  rewrite(
    file,
    /^HEIMDALL_PIN=.*$/m.test(content)
      ? content.replace(/^HEIMDALL_PIN=.*$/m, () => line)
      : `${content}${content.endsWith('\n') || content === '' ? '' : '\n'}${line}\n`,
  );
}

/**
 * Ask for a PIN on the terminal (typing hidden) and write it to .env. Returns
 * false without asking when there is no terminal (CI, a pipe, launchd), where
 * the caller's own "set HEIMDALL_PIN" message is the right answer.
 */
export async function askForPin(file: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  // terminal: false, so readline does not echo the keys itself; `stty -echo`
  // stops the terminal's own echo.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  try {
    for (;;) {
      // Echo off before the prompt appears, so keys typed straight away are hidden too.
      spawnSync('stty', ['-echo'], { stdio: 'inherit' });
      process.stdout.write(
        `Heimdall's admin PIN is not set. Choose one (${PIN_MIN}+ characters, hidden): `,
      );
      const pin = (await rl.question('')).trim();
      spawnSync('stty', ['echo'], { stdio: 'inherit' });
      process.stdout.write('\n');
      if (pin.length >= PIN_MIN) {
        writePin(file, pin);
        console.log('✔ HEIMDALL_PIN saved to .env');
        return true;
      }
      console.log(`✖ at least ${PIN_MIN} characters, please`);
    }
  } finally {
    spawnSync('stty', ['echo'], { stdio: 'inherit' });
    rl.close();
  }
}
