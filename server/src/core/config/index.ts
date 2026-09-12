import path from 'node:path';
import { z } from 'zod';
import { fromRepoRoot } from '../paths.js';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Rotated log files kept beside the active one. Exported because the boot path
 * needs it *before* config validation can succeed — a broken `.env` still has
 * to be able to write its own fatal line into the archive.
 */
export const DEFAULT_LOG_RETENTION_FILES = 30;

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
  GROOT_MAX_DOC_KB: z.coerce.number().int().positive().default(2048),
  ATLAS_MAX_DOC_KB: z.coerce.number().int().positive().default(2048),
  EDDA_LIVE_PREVIEW_MAX_KB: z.coerce.number().int().positive().default(300),
  // Accio (PLAN-13) — best-effort title enrichment. Both bound an outbound
  // request to a user-pasted address, so neither may be hardcoded.
  ACCIO_TITLE_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ACCIO_TITLE_MAX_BYTES: z.coerce.number().int().positive().default(131072),
  // Brotli (PLAN-25) — the two size caps and the per-route rate limit. The
  // OUTPUT cap is the decompression-bomb guard: unlike every other limit here
  // it bounds bytes the server *manufactures*, not bytes a client sent, which
  // is exactly why it cannot be derived from the input's declared size.
  BROTLI_MAX_INPUT_MB: z.coerce.number().int().positive().default(256),
  BROTLI_MAX_OUTPUT_MB: z.coerce.number().int().positive().default(512),
  BROTLI_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  // Nimbus (PLAN-14) — the largest payload one speed test may move in either
  // direction. Also the upload cap: past it /api/nimbus/up answers 413.
  NIMBUS_MAX_TEST_MB: z.coerce.number().int().min(1).max(1024).default(100),
  // Loki (PLAN-12) — Part B execution defaults; the runner reads these.
  LOKI_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LOKI_CONSOLE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  // Execution master switch + runner fetch access (Heimdall-overridable). The
  // run UI is additionally gated to the local profile client-side.
  LOKI_EXECUTION_ENABLED: z.enum(['true', 'false']).default('true'),
  LOKI_FETCH_ALLOWED: z.enum(['true', 'false']).default('true'),
  // Nótt (idle particle screensaver) — desktop-only overlay defaults; the
  // client reads these, Heimdall overrides them at runtime. Idle/rotate are
  // seconds; density/motion are enums the particle engine maps to counts/speed.
  SCREENSAVER_ENABLED: z.enum(['true', 'false']).default('true'),
  SCREENSAVER_IDLE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  SCREENSAVER_PARTICLE_DENSITY: z.enum(['low', 'medium', 'high']).default('medium'),
  SCREENSAVER_MOTION: z.enum(['calm', 'normal', 'lively']).default('normal'),
  SCREENSAVER_CONNECT_LINES: z.enum(['true', 'false']).default('true'),
  SCREENSAVER_MOUSE_REACTIVE: z.enum(['true', 'false']).default('true'),
  SCREENSAVER_SHOW_QUOTES: z.enum(['true', 'false']).default('true'),
  SCREENSAVER_QUOTE_ROTATE_SECONDS: z.coerce.number().int().min(4).max(120).default(14),
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
  // Default `trace`, not `info` (PLAN-16a): with the in-app log viewer gone the
  // file is a pure archive feeding Loki, so level is a *query-time* decision,
  // not a write-time one that silently discards data you can never get back.
  // The knob stays as the escape hatch if a dependency turns out to be noisy.
  LOG_LEVEL: z.enum(LOG_LEVELS).default('trace'),
  // Rotated log files kept beside the active one. Trace-level volume makes an
  // unbounded log folder a real disk-growth path on an unattended appliance;
  // Loki holds the searchable history, so the local files only need to cover
  // the window before Alloy catches up.
  LOG_RETENTION_FILES: z.coerce.number().int().min(1).default(DEFAULT_LOG_RETENTION_FILES),
  // Floor for browser-side logging (PLAN-16a). Every client line crosses the
  // network into an unauthenticated endpoint, so the economics invert against
  // the server's `trace`: warn+ only, lowered temporarily when chasing a bug.
  // Shipped to the static bundle via GET /api/client-logs/config.
  CLIENT_LOG_LEVEL: z.enum(LOG_LEVELS).default('warn'),
  // Bounds on that unauthenticated write path: a misbehaving tab must not be
  // able to fill storage/logs/. Batches per minute per IP, entries per batch,
  // and the request body cap (past it the route answers 413).
  CLIENT_LOG_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  CLIENT_LOG_MAX_BATCH: z.coerce.number().int().positive().max(500).default(50),
  CLIENT_LOG_MAX_BODY_KB: z.coerce.number().int().positive().default(64),
  // Metrics snapshots (PLAN-16b). The snapshot is the durable record, so
  // METRICS_ENABLED is the ONLY off-switch — raising LOG_LEVEL must never stop
  // it (the module logs through a trace-pinned child for exactly that reason).
  METRICS_ENABLED: z.enum(['true', 'false']).default('true'),
  METRICS_SNAPSHOT_INTERVAL_SEC: z.coerce.number().int().min(1).default(60),
  // Deliberately far slower than the snapshot: the disk walk is synchronous and
  // recursive, so sampling it per snapshot would block the event loop on every
  // snapshot and the sampler would record the lag spike it just caused.
  METRICS_DISK_INTERVAL_SEC: z.coerce.number().int().min(1).default(1800),
  // OpenTelemetry tracing (PLAN-16b). OFF by default: a dead OTLP endpoint
  // makes the exporter retry and log connection errors into storage/logs/ —
  // observability tooling degrading the observability record. Flip it on only
  // when the stack is up.
  OTEL_ENABLED: z.enum(['true', 'false']).default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_EXPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  OTEL_SERVICE_NAME: z.string().min(1).default('bifrost'),
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
  groot: {
    maxDocKb: number;
  };
  atlas: {
    maxDocKb: number;
  };
  accio: {
    /** Per-attempt timeout for the post-save `<title>` lookup. */
    titleTimeoutMs: number;
    /** Hard cap on how much of a page body the lookup reads. */
    titleMaxBytes: number;
  };
  brotli: {
    /** Largest body /api/brotli/compress will accept (413 past it). */
    maxInputMb: number;
    /** Largest output /api/brotli/decompress may produce — the bomb guard. */
    maxOutputMb: number;
    /** Per-IP requests per minute, budgeted per route rather than shared. */
    rateLimitPerMin: number;
  };
  nimbus: {
    /** Largest test payload per direction; also the hard upload cap (413 past it). */
    maxTestMb: number;
  };
  loki: {
    /** Default execution watchdog timeout (Part B); user-adjustable per run. */
    runTimeoutMs: number;
    /** Default console entry budget per run (Part B). */
    consoleMaxEntries: number;
    /** Master switch: is sandboxed execution offered at all (Heimdall). */
    executionEnabled: boolean;
    /** May a run call fetch() (LAN self-API use); Heimdall-switchable. */
    fetchAllowed: boolean;
  };
  screensaver: {
    /** Master switch: is the idle screensaver offered at all. */
    enabled: boolean;
    /** Inactivity before the overlay appears, in seconds. */
    idleSeconds: number;
    /** Particle count band the engine maps to a concrete number. */
    density: 'low' | 'medium' | 'high';
    /** Drift/parallax speed band. */
    motion: 'calm' | 'normal' | 'lively';
    /** Draw connecting lines between near particles on the far layer. */
    connectLines: boolean;
    /** Let cursor movement nudge the particles (never dismisses). */
    mouseReactive: boolean;
    /** Show a random lore quote above the particles. */
    showQuotes: boolean;
    /** Seconds each quote stays before another is chosen. */
    quoteRotateSeconds: number;
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
  /** Rotated log files kept beside the active one (pino-roll's file limit). */
  logRetentionFiles: number;
  clientLogs: {
    /** Floor for browser-side logging: the client filters, the server enforces. */
    level: LogLevel;
    /** Batches accepted per minute, per IP. */
    rateLimitPerMin: number;
    /** Entries one batch may carry. */
    maxBatch: number;
    /** Request body cap; past it the route answers 413 without reading it. */
    maxBodyBytes: number;
  };
  metrics: {
    /** The one off-switch for the snapshot record; LOG_LEVEL must not affect it. */
    enabled: boolean;
    /** Seconds between snapshot lines. */
    snapshotIntervalSec: number;
    /** Seconds between the (expensive, synchronous) disk walks. */
    diskIntervalSec: number;
  };
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

/**
 * Where logs go, resolved from the raw environment with nothing else validated.
 * Exists for exactly one caller: the boot path, which must be able to write a
 * `fatal` line about an invalid `.env` — the commonest startup failure — into
 * the archive rather than only to a stderr nobody is watching under PM2.
 */
export function logsDirFromEnv(env: Env = process.env): string {
  return resolveStoragePaths(env.STORAGE_ROOT || './storage').logs;
}

export interface OtelSettings {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
  serviceName: string;
}

/**
 * Tracing settings, read without validating anything else.
 *
 * `server/src/otel.ts` is loaded via `node --import` *before* the app, so a
 * full `loadConfig()` there would fail on unrelated keys (HEIMDALL_PIN) and
 * take the process down before it ever started — for a feature that is off by
 * default. Keeping the raw read here means `process.env` still has exactly one
 * home (coding rule), and the defaults stay beside every other default.
 */
export function otelSettingsFromEnv(env: Env = process.env): OtelSettings {
  const timeout = Number(env.OTEL_EXPORT_TIMEOUT_MS);
  return {
    enabled: env.OTEL_ENABLED === 'true',
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 3000,
    serviceName: env.OTEL_SERVICE_NAME || 'bifrost',
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
    groot: {
      maxDocKb: raw.GROOT_MAX_DOC_KB,
    },
    atlas: {
      maxDocKb: raw.ATLAS_MAX_DOC_KB,
    },
    accio: {
      titleTimeoutMs: raw.ACCIO_TITLE_TIMEOUT_MS,
      titleMaxBytes: raw.ACCIO_TITLE_MAX_BYTES,
    },
    brotli: {
      maxInputMb: raw.BROTLI_MAX_INPUT_MB,
      maxOutputMb: raw.BROTLI_MAX_OUTPUT_MB,
      rateLimitPerMin: raw.BROTLI_RATE_LIMIT_PER_MIN,
    },
    nimbus: {
      maxTestMb: raw.NIMBUS_MAX_TEST_MB,
    },
    loki: {
      runTimeoutMs: raw.LOKI_RUN_TIMEOUT_MS,
      consoleMaxEntries: raw.LOKI_CONSOLE_MAX_ENTRIES,
      executionEnabled: raw.LOKI_EXECUTION_ENABLED === 'true',
      fetchAllowed: raw.LOKI_FETCH_ALLOWED === 'true',
    },
    screensaver: {
      enabled: raw.SCREENSAVER_ENABLED === 'true',
      idleSeconds: raw.SCREENSAVER_IDLE_SECONDS,
      density: raw.SCREENSAVER_PARTICLE_DENSITY,
      motion: raw.SCREENSAVER_MOTION,
      connectLines: raw.SCREENSAVER_CONNECT_LINES === 'true',
      mouseReactive: raw.SCREENSAVER_MOUSE_REACTIVE === 'true',
      showQuotes: raw.SCREENSAVER_SHOW_QUOTES === 'true',
      quoteRotateSeconds: raw.SCREENSAVER_QUOTE_ROTATE_SECONDS,
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
    logRetentionFiles: raw.LOG_RETENTION_FILES,
    clientLogs: {
      level: raw.CLIENT_LOG_LEVEL,
      rateLimitPerMin: raw.CLIENT_LOG_RATE_LIMIT_PER_MIN,
      maxBatch: raw.CLIENT_LOG_MAX_BATCH,
      maxBodyBytes: raw.CLIENT_LOG_MAX_BODY_KB * 1024,
    },
    metrics: {
      enabled: raw.METRICS_ENABLED === 'true',
      snapshotIntervalSec: raw.METRICS_SNAPSHOT_INTERVAL_SEC,
      diskIntervalSec: raw.METRICS_DISK_INTERVAL_SEC,
    },
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
  // NOTE: there is deliberately no 'log.level' overlay. PLAN-16a deleted
  // Heimdall's runtime level switch, making LOG_LEVEL in .env authoritative;
  // migration 0009 removes any row a previous version persisted. Re-adding an
  // overlay here would strand an upgraded install at a level nobody chose.
  'loki.executionEnabled': (config, value) => {
    config.loki.executionEnabled = value === 'true';
  },
  'loki.fetchAllowed': (config, value) => {
    config.loki.fetchAllowed = value === 'true';
  },
  'loki.runTimeoutMs': (config, value) => {
    const ms = Number(value);
    if (Number.isInteger(ms) && ms >= 250 && ms <= 30000) config.loki.runTimeoutMs = ms;
  },
  'loki.consoleMaxEntries': (config, value) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 10 && n <= 5000) config.loki.consoleMaxEntries = n;
  },
  'screensaver.enabled': (config, value) => {
    config.screensaver.enabled = value === 'true';
  },
  'screensaver.idleSeconds': (config, value) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 5 && n <= 3600) config.screensaver.idleSeconds = n;
  },
  'screensaver.density': (config, value) => {
    if (value === 'low' || value === 'medium' || value === 'high') config.screensaver.density = value;
  },
  'screensaver.motion': (config, value) => {
    if (value === 'calm' || value === 'normal' || value === 'lively') config.screensaver.motion = value;
  },
  'screensaver.connectLines': (config, value) => {
    config.screensaver.connectLines = value === 'true';
  },
  'screensaver.mouseReactive': (config, value) => {
    config.screensaver.mouseReactive = value === 'true';
  },
  'screensaver.showQuotes': (config, value) => {
    config.screensaver.showQuotes = value === 'true';
  },
  'screensaver.quoteRotateSeconds': (config, value) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 4 && n <= 120) config.screensaver.quoteRotateSeconds = n;
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
