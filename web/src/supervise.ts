import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

/**
 * Run the hub's processes as one (PLAN-36's `npm start`): start each child,
 * prefix its output with its name, forward SIGINT/SIGTERM, and treat any
 * child dying on its own as the whole thing failing — a hub with only half of
 * itself up must not look healthy to whoever started it. Not `concurrently`,
 * which is a devDependency and so not there for a production `npm start`.
 *
 * Shutdown order is the list's REVERSE order: the web host (listed last) stops
 * accepting first, then the API drains, as the plan's shutdown order requires.
 *
 * Each child runs in its own process group (`detached`), so a terminal's
 * Ctrl-C reaches only this supervisor, which then signals the children once,
 * in order. Without that, every child would get the terminal's SIGINT AND the
 * forwarded one, and the API treats a second signal as "exit now", skipping
 * its database checkpoint. Repeated signals here are ignored for the same
 * reason. The cost: a supervisor killed with SIGKILL leaves its children
 * running, which only `npm start` has (PM2, launchd and compose run the two
 * processes directly).
 */

export interface ChildSpec {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SuperviseOptions {
  /** Where prefixed output goes (tests capture it). */
  out?: (line: string) => void;
  /** How long a child gets to exit on its own after a signal before SIGKILL. */
  killAfterMs?: number;
  /** Test seam: the process whose signals are forwarded. */
  signals?: NodeJS.EventEmitter;
}

export interface Supervisor {
  /** Resolves with the exit code the supervisor should exit with. */
  done: Promise<number>;
  stop(signal?: NodeJS.Signals): void;
}

export function supervise(specs: readonly ChildSpec[], options: SuperviseOptions = {}): Supervisor {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const killAfterMs = options.killAfterMs ?? 15_000;
  const signals = options.signals ?? process;
  const width = Math.max(...specs.map((spec) => spec.name.length));
  const children = new Map<string, ChildProcess>();
  const exited = new Map<string, number>();
  let stopping = false;
  let failure: number | null = null;
  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  const prefix = (name: string) => `[${name.padEnd(width)}]`;

  const stopInOrder = async (signal: NodeJS.Signals): Promise<void> => {
    for (const spec of [...specs].reverse()) {
      const child = children.get(spec.name);
      if (!child || exited.has(spec.name)) continue;
      child.kill(signal);
      const killer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      await new Promise<void>((resolve) => {
        if (exited.has(spec.name)) return resolve();
        child.once('close', () => resolve());
      });
      clearTimeout(killer);
    }
  };

  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    void stopInOrder(signal);
  };

  for (const spec of specs) {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    children.set(spec.name, child);
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      readline
        .createInterface({ input: stream })
        .on('line', (line) => out(`${prefix(spec.name)} ${line}`));
    }
    // 'close', not 'exit': it fires only once the child's output has been
    // read to the end, so its last lines are never lost.
    child.on('close', (code, signal) => {
      exited.set(spec.name, code ?? (signal ? 1 : 0));
      if (!stopping) {
        // A child went down on its own: the hub is half up, which is down.
        failure = code === 0 ? 1 : (code ?? 1);
        out(`${prefix(spec.name)} exited (${signal ?? `code ${code}`}) — stopping the rest`);
        stop('SIGTERM');
      }
      if (exited.size === specs.length) {
        const worst = Math.max(...exited.values());
        resolveDone(failure ?? worst);
      }
    });
  }

  const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    out(
      `[start] ${signal} — stopping ${specs
        .map((spec) => spec.name)
        .reverse()
        .join(', then ')}`,
    );
    // A hang-up is not a request each child understands; ask them to stop.
    stop(signal === 'SIGHUP' ? 'SIGTERM' : signal);
  };
  for (const signal of FORWARDED) signals.on(signal, onSignal);
  void done.then(() => {
    for (const signal of FORWARDED) signals.removeListener(signal, onSignal);
  });

  return { done, stop };
}
