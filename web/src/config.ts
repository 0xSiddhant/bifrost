import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * The web host's view of the shared `.env` (PLAN-36). It reads only the keys
 * it needs, with the same names, defaults and rules the API server uses, so
 * one `.env` drives both processes. Workspaces do not import each other, so
 * the few rules that must agree (API_PORT = PORT + 1 by default) are repeated
 * here on purpose, and a test pins them to the server's documented defaults.
 */

// web/src/ or web/dist/ — both are two levels below the repo root.
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function fromRepoRoot(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}

export function loadDotenv(): void {
  dotenv.config({ path: fromRepoRoot('.env'), quiet: true });
}

export const RUN_MODES = ['full', 'api', 'web'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * Who answers for `<MDNS_NAME>.local` (PLAN-39): the web host itself (the
 * default), a separate native advertiser process (a web host in Docker on the
 * Mac, whose multicast cannot leave Docker Desktop's VM), or nobody.
 */
export const MDNS_ADVERTISERS = ['web', 'host', 'off'] as const;
export type MdnsAdvertiser = (typeof MDNS_ADVERTISERS)[number];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const schema = z
  .object({
    DEPLOY_PROFILE: z.enum(['local', 'cloud'], { error: 'must be "local" or "cloud" (required)' }),
    PORT: z
      .string({ error: 'required — the port people open, e.g. 4646' })
      .transform(Number)
      .pipe(z.number({ error: 'must be a number' }).int().min(1).max(65535)),
    API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    BIFROST_RUN: z.enum(RUN_MODES, { error: 'must be "full", "api" or "web"' }).default('full'),
    WEB_HOST: z.string().min(1).default('0.0.0.0'),
    MDNS_ADVERTISER: z
      .enum(MDNS_ADVERTISERS, { error: 'must be "web", "host" or "off"' })
      .default('web'),
    MDNS_NAME: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'must be a valid hostname label (lowercase letters, digits, dashes)')
      .default('bifrost'),
    STORAGE_ROOT: z.string().min(1).default('./storage'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('trace'),
    LOG_RETENTION_FILES: z.coerce.number().int().min(1).default(30),
  })
  .refine((env) => (env.API_PORT ?? env.PORT + 1) !== env.PORT, {
    path: ['API_PORT'],
    message: 'must differ from PORT (the web host listens on PORT, the API behind it)',
  })
  .refine((env) => (env.API_PORT ?? env.PORT + 1) <= 65535, {
    path: ['API_PORT'],
    message: 'PORT + 1 is not a port; set API_PORT explicitly',
  });

export interface WebConfig {
  profile: 'local' | 'cloud';
  /** Where the web host listens: PORT, the address everyone opens. */
  port: number;
  host: string;
  /** Where the API it forwards to listens. */
  api: { host: string; port: number };
  runMode: RunMode;
  mdnsAdvertiser: MdnsAdvertiser;
  mdnsName: string;
  logsDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  logRetentionFiles: number;
}

export class WebConfigError extends Error {}

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const filled = Object.fromEntries(Object.entries(env).filter(([, value]) => Boolean(value)));
  const parsed = schema.safeParse(filled);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new WebConfigError(`Invalid configuration in .env:\n${lines.join('\n')}`);
  }
  const raw = parsed.data;
  const storageRoot = path.isAbsolute(raw.STORAGE_ROOT)
    ? raw.STORAGE_ROOT
    : fromRepoRoot(raw.STORAGE_ROOT);
  return {
    profile: raw.DEPLOY_PROFILE,
    port: raw.PORT,
    host: raw.WEB_HOST,
    api: { host: raw.API_HOST, port: raw.API_PORT ?? raw.PORT + 1 },
    runMode: raw.BIFROST_RUN,
    mdnsAdvertiser: raw.MDNS_ADVERTISER,
    mdnsName: raw.MDNS_NAME,
    logsDir: path.join(storageRoot, 'logs'),
    logLevel: raw.LOG_LEVEL,
    logRetentionFiles: raw.LOG_RETENTION_FILES,
  };
}

/** True when a bind address is reachable only from this machine. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}
