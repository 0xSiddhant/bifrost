/**
 * The values a client build bakes in (PLAN-35), read from the repo-root `.env`
 * the server also reads. Vite inlines them with `define`, so a change needs a
 * rebuild; that is why the editor caps are the **same keys** the server
 * enforces rather than a client copy that could drift.
 *
 * Runs in Node, from `vite.config.ts`, never in the browser. A malformed value
 * fails the build: a client that silently baked in a default would disagree
 * with a server that read the real value.
 */

export type Build = 'hub' | 'standalone';

export interface BuildDefaults {
  caps: {
    runestoneMaxDocKb: number;
    eddaMaxDocKb: number;
    eddaLivePreviewMaxKb: number;
    grootMaxDocKb: number;
    atlasMaxDocKb: number;
  };
  loki: {
    executionEnabled: boolean;
    fetchAllowed: boolean;
    runTimeoutMs: number;
    consoleMaxEntries: number;
  };
  screensaver: {
    enabled: boolean;
    idleSeconds: number;
    density: 'low' | 'medium' | 'high';
    motion: 'calm' | 'normal' | 'lively';
    connectLines: boolean;
    mouseReactive: boolean;
    showQuotes: boolean;
    quoteRotateSeconds: number;
  };
  heimdall: {
    shortcut: string;
    tapCount: number;
  };
}

/** The `.env.example` defaults; `buildDefaults.test.ts` holds the two in step. */
export const ENV_DEFAULTS = {
  RUNESTONE_MAX_DOC_KB: '2048',
  EDDA_MAX_DOC_KB: '2048',
  EDDA_LIVE_PREVIEW_MAX_KB: '300',
  GROOT_MAX_DOC_KB: '2048',
  ATLAS_MAX_DOC_KB: '2048',
  LOKI_EXECUTION_ENABLED: 'true',
  LOKI_FETCH_ALLOWED: 'true',
  LOKI_RUN_TIMEOUT_MS: '5000',
  LOKI_CONSOLE_MAX_ENTRIES: '500',
  SCREENSAVER_ENABLED: 'true',
  SCREENSAVER_IDLE_SECONDS: '60',
  SCREENSAVER_PARTICLE_DENSITY: 'medium',
  SCREENSAVER_MOTION: 'normal',
  SCREENSAVER_CONNECT_LINES: 'true',
  SCREENSAVER_MOUSE_REACTIVE: 'true',
  SCREENSAVER_SHOW_QUOTES: 'true',
  SCREENSAVER_QUOTE_ROTATE_SECONDS: '14',
  HEIMDALL_SHORTCUT_DEFAULT: 'shift+meta+comma',
  HEIMDALL_TAP_COUNT: '7',
} as const;

export type BuildEnvKey = keyof typeof ENV_DEFAULTS;

/** The editor caps, by env key: what `bifrost-build.json` records for the server's drift check. */
export const CAP_KEYS = [
  'RUNESTONE_MAX_DOC_KB',
  'EDDA_MAX_DOC_KB',
  'EDDA_LIVE_PREVIEW_MAX_KB',
  'GROOT_MAX_DOC_KB',
  'ATLAS_MAX_DOC_KB',
] as const satisfies readonly BuildEnvKey[];

export function buildOf(mode: string): Build {
  return mode === 'standalone' ? 'standalone' : 'hub';
}

/**
 * Read the baked values from `env` (normally `process.env` after dotenv),
 * falling back to the `.env.example` default for a missing or empty key.
 * Ranges match the server's zod schema, so a value the server would refuse at
 * boot also refuses to build.
 */
export function readBuildDefaults(env: Record<string, string | undefined>): BuildDefaults {
  const raw = (key: BuildEnvKey): string => {
    const value = env[key]?.trim();
    return value ? value : ENV_DEFAULTS[key];
  };
  const int = (key: BuildEnvKey, min: number, max: number): number => {
    const value = Number(raw(key));
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${key}=${raw(key)} must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  const bool = (key: BuildEnvKey): boolean => {
    const value = raw(key);
    if (value !== 'true' && value !== 'false')
      throw new Error(`${key}=${value} must be true or false`);
    return value === 'true';
  };
  const oneOf = <T extends string>(key: BuildEnvKey, values: readonly T[]): T => {
    const value = raw(key);
    if (!(values as readonly string[]).includes(value)) {
      throw new Error(`${key}=${value} must be one of ${values.join(', ')}`);
    }
    return value as T;
  };
  // Positive integers, as the server's zod schema has them: no upper bound.
  const POSITIVE = [1, Number.MAX_SAFE_INTEGER] as const;

  return {
    caps: {
      runestoneMaxDocKb: int('RUNESTONE_MAX_DOC_KB', ...POSITIVE),
      eddaMaxDocKb: int('EDDA_MAX_DOC_KB', ...POSITIVE),
      eddaLivePreviewMaxKb: int('EDDA_LIVE_PREVIEW_MAX_KB', ...POSITIVE),
      grootMaxDocKb: int('GROOT_MAX_DOC_KB', ...POSITIVE),
      atlasMaxDocKb: int('ATLAS_MAX_DOC_KB', ...POSITIVE),
    },
    loki: {
      executionEnabled: bool('LOKI_EXECUTION_ENABLED'),
      fetchAllowed: bool('LOKI_FETCH_ALLOWED'),
      runTimeoutMs: int('LOKI_RUN_TIMEOUT_MS', ...POSITIVE),
      consoleMaxEntries: int('LOKI_CONSOLE_MAX_ENTRIES', ...POSITIVE),
    },
    screensaver: {
      enabled: bool('SCREENSAVER_ENABLED'),
      idleSeconds: int('SCREENSAVER_IDLE_SECONDS', 5, 3600),
      density: oneOf('SCREENSAVER_PARTICLE_DENSITY', ['low', 'medium', 'high'] as const),
      motion: oneOf('SCREENSAVER_MOTION', ['calm', 'normal', 'lively'] as const),
      connectLines: bool('SCREENSAVER_CONNECT_LINES'),
      mouseReactive: bool('SCREENSAVER_MOUSE_REACTIVE'),
      showQuotes: bool('SCREENSAVER_SHOW_QUOTES'),
      quoteRotateSeconds: int('SCREENSAVER_QUOTE_ROTATE_SECONDS', 4, 120),
    },
    heimdall: {
      shortcut: raw('HEIMDALL_SHORTCUT_DEFAULT'),
      tapCount: int('HEIMDALL_TAP_COUNT', 3, 20),
    },
  };
}

/** What `client/dist/bifrost-build.json` holds: the build and the caps it baked in, by env key. */
export function buildManifest(build: Build, defaults: BuildDefaults): Record<string, unknown> {
  return {
    build,
    caps: {
      RUNESTONE_MAX_DOC_KB: defaults.caps.runestoneMaxDocKb,
      EDDA_MAX_DOC_KB: defaults.caps.eddaMaxDocKb,
      EDDA_LIVE_PREVIEW_MAX_KB: defaults.caps.eddaLivePreviewMaxKb,
      GROOT_MAX_DOC_KB: defaults.caps.grootMaxDocKb,
      ATLAS_MAX_DOC_KB: defaults.caps.atlasMaxDocKb,
    },
  };
}
