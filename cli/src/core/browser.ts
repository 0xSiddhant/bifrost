import open from 'open';
import { CliError, isJsonMode } from './output.js';

/**
 * Launching the OS's browser. One mechanism for both callers — `preview`
 * (default-on) and `portkey go --open` (opt-in) — because `start`/`xdg-open`/
 * `open` differ per platform and have real shell-quoting hazards; the `open`
 * package is the same small-single-purpose-dependency call `commander` is.
 *
 * Naming coincidence worth stating once: the `open` dependency and the CLI's
 * own `open <slug>` command are unrelated (launch a browser vs. fetch raw
 * document bytes), and nothing in the UX exposes the dependency's name.
 */

/**
 * Whether a command should actually launch anything.
 *
 * `--json` overrides `--no-open`'s own value unconditionally: a scripted, piped
 * invocation must never have the side effect of opening a GUI app.
 */
export function shouldLaunch(noOpen: boolean): boolean {
  return !noOpen && !isJsonMode();
}

export async function openInBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch (error) {
    throw new CliError(
      `couldn't open a browser for ${url}: ${(error as Error).message} — ` +
        'pass --no-open to print the URL instead',
    );
  }
}
