import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { supervise, type ChildSpec } from './supervise.js';

/** `npm start`'s supervisor (PLAN-36 criterion 6): one command starts both, one stops both. */

const node = (name: string, code: string): ChildSpec => ({
  name,
  command: process.execPath,
  args: ['-e', code],
});
/** A child that runs until signalled, says when it is asked to stop, and exits 0. */
const longRunning = (name: string) =>
  node(
    name,
    `console.log('up'); process.on('SIGTERM', () => { console.log('stopping'); process.exit(0); }); ` +
      `process.on('SIGINT', () => { console.log('stopping'); process.exit(0); }); setInterval(() => {}, 1000);`,
  );

async function waitFor(lines: string[], text: string): Promise<void> {
  for (let i = 0; i < 100 && !lines.some((line) => line.includes(text)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('supervise', () => {
  it("prefixes each child's output (stdout and stderr) with its name", async () => {
    const lines: string[] = [];
    const signals = new EventEmitter();
    const idle = `process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);`;
    const run = supervise(
      [node('api', `console.log('hello'); ${idle}`), node('web', `console.error('oops'); ${idle}`)],
      { out: (line) => lines.push(line), signals },
    );
    await waitFor(lines, '[api] hello');
    await waitFor(lines, '[web] oops');
    signals.emit('SIGTERM', 'SIGTERM');
    expect(await run.done).toBe(0);
    expect(lines).toEqual(expect.arrayContaining(['[api] hello', '[web] oops']));
  });

  it('forwards a signal and stops the web host before the API, exiting 0', async () => {
    const lines: string[] = [];
    const signals = new EventEmitter();
    const run = supervise([longRunning('api'), longRunning('web')], {
      out: (line) => lines.push(line),
      signals,
    });
    await waitFor(lines, '[web] up');
    await waitFor(lines, '[api] up');
    signals.emit('SIGTERM', 'SIGTERM');
    expect(await run.done).toBe(0);
    const order = lines.filter((line) => line.endsWith('stopping'));
    expect(order).toEqual(['[web] stopping', '[api] stopping']);
  });

  it('stops everything and exits non-zero when one child dies on its own', async () => {
    const lines: string[] = [];
    const run = supervise(
      [longRunning('api'), node('web', 'setTimeout(() => process.exit(3), 200)')],
      {
        out: (line) => lines.push(line),
        signals: new EventEmitter(),
      },
    );
    expect(await run.done).toBe(3);
    expect(lines.some((line) => line.includes('[web] exited (code 3)'))).toBe(true);
    expect(lines).toContain('[api] stopping');
  });

  it('counts a clean exit nobody asked for as a failure too', async () => {
    const run = supervise([longRunning('api'), node('web', 'process.exit(0)')], {
      out: () => {},
      signals: new EventEmitter(),
    });
    expect(await run.done).toBe(1);
  });
});

describe('supervise, repeated signals', () => {
  it('signals each child once, however many signals arrive', async () => {
    const lines: string[] = [];
    const signals = new EventEmitter();
    const run = supervise([longRunning('api'), longRunning('web')], {
      out: (line) => lines.push(line),
      signals,
    });
    await waitFor(lines, '[web] up');
    await waitFor(lines, '[api] up');
    signals.emit('SIGINT', 'SIGINT');
    signals.emit('SIGINT', 'SIGINT');
    signals.emit('SIGHUP', 'SIGHUP');
    expect(await run.done).toBe(0);
    expect(lines.filter((line) => line.endsWith('stopping'))).toEqual([
      '[web] stopping',
      '[api] stopping',
    ]);
  });
});
