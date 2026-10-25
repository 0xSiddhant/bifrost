import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import type { AppConfig } from './config/index.js';

/**
 * The editor caps are baked into the client at build time from the same
 * `.env` keys the server enforces (PLAN-35). A changed key needs a client
 * rebuild, and a forgotten one must be visible rather than silent: the build
 * writes the caps it baked in to `client/dist/bifrost-build.json`, and boot
 * warns for each key whose `.env` value differs. The server still enforces
 * its own number, so drift only ever costs a late 413, never a bypass.
 */

export interface ClientBuildManifest {
  build: string;
  caps: Record<string, number>;
}

export interface CapDrift {
  key: string;
  built: number;
  enforced: number;
}

export function readClientBuild(clientDistDir: string): ClientBuildManifest | null {
  const file = path.join(clientDistDir, 'bifrost-build.json');
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ClientBuildManifest>;
  if (typeof parsed.build !== 'string' || typeof parsed.caps !== 'object' || parsed.caps === null) {
    throw new Error(`${file} is not a client build manifest`);
  }
  return { build: parsed.build, caps: parsed.caps };
}

/** The caps this server enforces, by the `.env` key the client build also reads. */
export function enforcedCaps(config: AppConfig): Record<string, number> {
  return {
    RUNESTONE_MAX_DOC_KB: config.runestone.maxDocKb,
    EDDA_MAX_DOC_KB: config.edda.maxDocKb,
    EDDA_LIVE_PREVIEW_MAX_KB: config.edda.livePreviewMaxKb,
    GROOT_MAX_DOC_KB: config.groot.maxDocKb,
    ATLAS_MAX_DOC_KB: config.atlas.maxDocKb,
  };
}

export function capDrift(manifest: ClientBuildManifest, config: AppConfig): CapDrift[] {
  return Object.entries(enforcedCaps(config)).flatMap(([key, enforced]) => {
    const built = manifest.caps[key];
    return typeof built === 'number' && built !== enforced ? [{ key, built, enforced }] : [];
  });
}

/** Boot check: one `warn` per drifted key, naming both numbers and the fix. */
export function checkClientBuild(clientDistDir: string, config: AppConfig, log: Logger): void {
  let manifest: ClientBuildManifest | null;
  try {
    manifest = readClientBuild(clientDistDir);
  } catch (err) {
    log.warn({ err, clientDistDir }, 'client build manifest unreadable — cannot check the baked-in caps');
    return;
  }
  if (!manifest) {
    // Dev (Vite serves the client) or a build from before PLAN-35: nothing to compare.
    log.debug({ clientDistDir }, 'no client build manifest — skipping the cap drift check');
    return;
  }
  if (manifest.build !== 'hub') {
    log.warn(
      { clientDistDir, build: manifest.build },
      `client/dist holds a ${manifest.build} build — run \`npm run build\` for the hub`,
    );
  }
  for (const drift of capDrift(manifest, config)) {
    log.warn(
      { key: drift.key, built: drift.built, enforced: drift.enforced },
      `client built with ${drift.key}=${drift.built}, server enforces ${drift.enforced} — rebuild the client`,
    );
  }
}
