import path from 'node:path';
import pino from 'pino';
import type { LogLevel } from '../config/index.js';

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

export function createLogger(options: LoggerOptions): Logger {
  const targets: pino.TransportTargetOptions[] = [
    { target: 'pino-roll', options: { ...rollOptions(options.logsDir) }, level: options.level },
  ];
  if (options.pretty) {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
      level: options.level,
    });
  }
  return pino({ level: options.level }, pino.transport({ targets }));
}

/** Every module logs through a child logger tagged with its name. */
export function moduleLogger(root: Logger, moduleName: string): Logger {
  return root.child({ module: moduleName });
}
