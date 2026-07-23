import path from 'node:path';
import { z } from 'zod';
import { fromRepoRoot } from '../paths.js';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type DeployProfile = 'local' | 'cloud';

const envSchema = z.object({
  DEPLOY_PROFILE: z.enum(['local', 'cloud']).default('local'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4646),
  MDNS_NAME: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'must be a valid hostname label (lowercase letters, digits, dashes)')
    .default('bifrost'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(2048),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(20),
  UPLOAD_EXT_BLOCKLIST: z.string().default('.exe,.bat,.cmd,.msi'),
  UPLOAD_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  CLIPBOARD_MAX_ENTRIES: z.coerce.number().int().positive().default(100),
  CLIPBOARD_MAX_TEXT_KB: z.coerce.number().int().positive().default(64),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  RUNESTONE_MAX_DOC_KB: z.coerce.number().int().positive().default(2048),
  EDDA_MAX_DOC_KB: z.coerce.number().int().positive().default(2048),
  EDDA_LIVE_PREVIEW_MAX_KB: z.coerce.number().int().positive().default(300),
  THEMES_DIR: z.string().min(1).default('./themes'),
  STORAGE_ROOT: z.string().min(1).default('./storage'),
  HEIMDALL_PIN: z.string().min(4, 'required, minimum 4 characters (set it in .env)'),
  HEIMDALL_SHORTCUT_DEFAULT: z.string().min(1).default('shift+meta+comma'),
  HEIMDALL_TAP_COUNT: z.coerce.number().int().min(3).max(20).default(7),
  // Encryption key for the admin session cookie (@fastify/secure-session).
  // Optional: when unset, a random key is generated at boot — sessions then
  // reset on restart. Set it (≥ 32 chars) to keep sessions across restarts.
  HEIMDALL_SESSION_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters when set')
    .optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  BACKUP_DIR: z.string().default(''),
  // Rotation: keep only the newest N archives in BACKUP_DIR. 0 = keep all.
  BACKUP_KEEP: z.coerce.number().int().min(0).default(0),
});

export interface StoragePaths {
  root: string;
  uploads: string;
  downloads: string;
  tmp: string;
  data: string;
  logs: string;
  dbFile: string;
}

export interface AppConfig {
  profile: DeployProfile;
  port: number;
  mdnsName: string;
  maxUploadSizeMb: number;
  maxFilesPerUpload: number;
  uploadExtBlocklist: readonly string[];
  uploadRateLimitPerMin: number;
  clipboard: {
    maxEntries: number;
    maxTextBytes: number;
  };
  auditRetentionDays: number;
  runestone: {
    maxDocKb: number;
  };
  edda: {
    maxDocKb: number;
    /** Above this, live preview auto-degrades to a manual "Refresh preview" button. */
    livePreviewMaxKb: number;
  };
  themes: {
    dir: string;
    /**
     * Explicit server default (DB settings overlay, Heimdall-set in PLAN-05).
     * null = not configured — clients then fall through to their
     * prefers-color-scheme match (resolution order in PLAN-04).
     */
    defaultId: string | null;
  };
  storage: StoragePaths;
  heimdall: {
    pin: string;
    shortcut: string;
    tapCount: number;
    /** null = generate a random session key at boot (sessions reset on restart). */
    sessionSecret: string | null;
  };
  logLevel: LogLevel;
  backupDir: string | null;
  /** Rotation: keep only the newest N archives (0 = keep all). */
  backupKeep: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

/** Empty strings in .env (e.g. `BACKUP_DIR=`) mean "unset" — fall through to defaults. */
function stripEmpty(env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function resolveStoragePaths(storageRoot: string): StoragePaths {
  const root = path.isAbsolute(storageRoot) ? storageRoot : fromRepoRoot(storageRoot);
  return {
    root,
    uploads: path.join(root, 'uploads'),
    downloads: path.join(root, 'downloads'),
    tmp: path.join(root, 'tmp'),
    data: path.join(root, 'data'),
    logs: path.join(root, 'logs'),
    dbFile: path.join(root, 'data', 'app.db'),
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const parsed = envSchema.safeParse(stripEmpty(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration in .env:\n${lines.join('\n')}`);
  }
  const raw = parsed.data;
  const config: AppConfig = {
    profile: raw.DEPLOY_PROFILE,
    port: raw.PORT,
    mdnsName: raw.MDNS_NAME,
    maxUploadSizeMb: raw.MAX_UPLOAD_SIZE_MB,
    maxFilesPerUpload: raw.MAX_FILES_PER_UPLOAD,
    uploadExtBlocklist: raw.UPLOAD_EXT_BLOCKLIST.split(',')
      .map((ext) => ext.trim().toLowerCase())
      .filter(Boolean),
    uploadRateLimitPerMin: raw.UPLOAD_RATE_LIMIT_PER_MIN,
    clipboard: {
      maxEntries: raw.CLIPBOARD_MAX_ENTRIES,
      maxTextBytes: raw.CLIPBOARD_MAX_TEXT_KB * 1024,
    },
    auditRetentionDays: raw.AUDIT_RETENTION_DAYS,
    runestone: {
      maxDocKb: raw.RUNESTONE_MAX_DOC_KB,
    },
    edda: {
      maxDocKb: raw.EDDA_MAX_DOC_KB,
      livePreviewMaxKb: raw.EDDA_LIVE_PREVIEW_MAX_KB,
    },
    themes: {
      dir: path.isAbsolute(raw.THEMES_DIR) ? raw.THEMES_DIR : fromRepoRoot(raw.THEMES_DIR),
      defaultId: null,
    },
    storage: resolveStoragePaths(raw.STORAGE_ROOT),
    heimdall: {
      pin: raw.HEIMDALL_PIN,
      shortcut: raw.HEIMDALL_SHORTCUT_DEFAULT,
      tapCount: raw.HEIMDALL_TAP_COUNT,
      sessionSecret: raw.HEIMDALL_SESSION_SECRET ?? null,
    },
    logLevel: raw.LOG_LEVEL,
    backupDir: raw.BACKUP_DIR || null,
    backupKeep: raw.BACKUP_KEEP,
  };
  return deepFreeze(config);
}

export interface SettingsRow {
  key: string;
  value: string;
}

/**
 * DB `settings` rows override the .env defaults for the keys listed here —
 * these are the runtime-mutable values (editable from Heimdall, PLAN-05).
 * Unknown keys are ignored; the returned config is a new frozen object.
 */
const OVERLAYS: Record<string, (config: AppConfig, value: string) => void> = {
  'heimdall.shortcut': (config, value) => {
    config.heimdall.shortcut = value;
  },
  'themes.default': (config, value) => {
    if (/^[a-z0-9-]{2,32}$/.test(value)) config.themes.defaultId = value;
  },
  'heimdall.tapCount': (config, value) => {
    const count = Number(value);
    if (Number.isInteger(count) && count >= 3 && count <= 20) config.heimdall.tapCount = count;
  },
  'log.level': (config, value) => {
    if ((LOG_LEVELS as readonly string[]).includes(value)) config.logLevel = value as LogLevel;
  },
};

export function applySettingsOverlay(base: AppConfig, rows: SettingsRow[]): AppConfig {
  const draft = structuredClone(base) as AppConfig;
  for (const row of rows) {
    OVERLAYS[row.key]?.(draft, row.value);
  }
  return deepFreeze(draft);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
