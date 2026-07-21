import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import type { LogLevel } from '../config/index.js';
import type { LogTap } from '../logtap.js';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level: LogLevel;
  logsDir: string;
  /** Mirror logs to stdout via pino-pretty (dev mode). */
  pretty: boolean;
}

/**
 * pino-roll options for the JSON file sink: daily rotation, 20 MB size cap,
 * `current.log` symlink always pointing at the active file (what `npm run logs` tails).
 */
export function rollOptions(logsDir: string) {
  return {
    file: path.join(logsDir, 'app'),
    extension: '.log',
    frequency: 'daily',
    size: '20m',
    mkdir: true,
    symlink: true,
  } as const;
}

export function createLogger(options: LoggerOptions, tap?: LogTap): Logger {
  // Destination levels are 'trace' so the root logger's (mutable) level is the
  // single gate — a runtime level switch then applies to file, stdout, and the
  // in-memory tap uniformly, with no per-stream re-filtering.
  const targets: pino.TransportTargetOptions[] = [
    { target: 'pino-roll', options: { ...rollOptions(options.logsDir) }, level: 'trace' },
  ];
  if (options.pretty) {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
      level: 'trace',
    });
  }
  const transport = pino.transport({ targets });
  if (!tap) return pino({ level: options.level }, transport);

  const tapStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      tap.writeLine(chunk.toString());
      callback();
    },
  });
  const destination = pino.multistream([
    { stream: transport, level: 'trace' },
    { stream: tapStream, level: 'trace' },
  ]);
  return pino({ level: options.level }, destination);
}

/** Every module logs through a child logger tagged with its name. */
export function moduleLogger(root: Logger, moduleName: string): Logger {
  return root.child({ module: moduleName });
}
