/**
 * One source of truth for cross-module event names and payloads.
 * Feature plans extend this map (dot-namespaced: `file.uploaded`,
 * `download.added`, `clipboard.updated`, ...).
 */

/** One entry of the downloads listing — also the SSE payload for download.* events. */
export interface DownloadEntry {
  /** Opaque id derived by the server; the only handle clients may use to fetch content. */
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  /** Lowercased extension including the dot, or '' when the name has none. */
  ext: string;
}

export interface FileUploadedEvent {
  /** Name as supplied by the client, pre-sanitization. */
  originalName: string;
  /**
   * Final name inside uploads/. Since PLAN-17b this is the sanitized name
   * itself — no timestamp prefix — with `-1`, `-2`, … added only when that
   * name was already taken.
   */
  storedName: string;
  /** Bytes. */
  size: number;
  /** Epoch milliseconds. */
  uploadedAt: number;
  /** Best-effort uploader identity (request IP) for the Heimdall metadata view; absent when unknown. */
  uploaderHint?: string;
}

/**
 * A staged upload was moved into downloads/ and is now on offer to the whole
 * LAN (PLAN-17b). It exists for the **banner only** — the Downloads listing
 * still comes from the watcher's `download.added`, which arrives later (after
 * chokidar's awaitWriteFinish debounce). Anything that banners on both events
 * announces every published file twice.
 */
export interface FilePublishedEvent {
  /** Final name in downloads/, suffixed if that name was already taken. */
  name: string;
  size: number;
  /** Epoch milliseconds. */
  publishedAt: number;
  /**
   * Device that pressed Move, so its own browser can stay quiet. Null when the
   * caller sent no device header — and a null origin must be shown to
   * *everyone*, never suppressed for everyone (see `shouldShowForOrigin`).
   */
  originDeviceId: string | null;
}

/**
 * Runtime settings changed in Heimdall (PLAN-05). Broadcast so open clients
 * rebind the entry gesture without a reload.
 */
export interface SettingsUpdatedEvent {
  shortcut: string;
  tapCount: number;
}

/** Effective Loki execution settings (PLAN-12 Part B) — public config shape. */
export interface LokiSettings {
  executionEnabled: boolean;
  fetchAllowed: boolean;
  runTimeoutMs: number;
  consoleMaxEntries: number;
}

/** Effective Nótt (idle screensaver) settings — public config shape. */
export interface ScreensaverSettings {
  enabled: boolean;
  idleSeconds: number;
  density: 'low' | 'medium' | 'high';
  motion: 'calm' | 'normal' | 'lively';
  connectLines: boolean;
  mouseReactive: boolean;
  showQuotes: boolean;
  quoteRotateSeconds: number;
}

/** One validated theme as the listing/SSE payload shows it. */
export interface ThemeSummary {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  preview: { bg: string; accent: string };
  builtIn: boolean;
  /** Contrast lint findings — warn, never block (PLAN-04). */
  warnings: string[];
}

/** A shared-clipboard entry — the list/SSE payload shape (PLAN-06). */
export interface ClipboardEntry {
  id: string;
  text: string;
  kind: 'text' | 'code';
  lang: string | null;
  /** Stable id of the posting device, resolved to a name client-side via presence. */
  deviceId: string | null;
  createdAt: number;
}

/** Delta broadcast on any clipboard change — clients apply it without a refetch. */
export type ClipboardChange =
  | { action: 'add'; entry: ClipboardEntry }
  | { action: 'delete'; id: string };

/** A device as the presence dashboard shows it (PLAN-06). */
export interface PresenceDevice {
  deviceId: string;
  /** Friendly claimed name, or null. */
  name: string | null;
  /** Auto-assigned character alias ("Thor"); the default display name. */
  charName: string | null;
  /** UA-derived label, e.g. "iPhone · Safari" — shown alongside the alias in Heimdall only. */
  label: string;
  online: boolean;
  lastSeen: number;
}

/** A saved JSON document as the library lists it (PLAN-07 Part B). */
export interface RunestoneSummary {
  id: string;
  name: string;
  /** `<kebab-name>-<id>`; regenerates on rename, old id-links still resolve. */
  slug: string;
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

/** A saved Markdown document as the Edda library lists it (PLAN-11). */
export interface EddaSummary {
  id: string;
  name: string;
  /** `<kebab-name>-<id>`; regenerates on rename, old id-links still resolve. */
  slug: string;
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

/** A saved link as the Accio shelf lists it (PLAN-13). */
export interface AccioLink {
  id: string;
  /** Normalized absolute http(s) URL. */
  url: string;
  /**
   * Best-effort page title. Null when the client supplied none and enrichment
   * has not (or will never) find one — the shelf then shows the bare URL.
   */
  title: string | null;
  /** Flat, lowercased, deduped labels — no folders (see the plan). */
  tags: string[];
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  authorDeviceId: string | null;
  createdAt: number;
}

/** One completed LAN speed test as the history lists it (PLAN-14). */
export interface NimbusResult {
  id: number;
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  deviceId: string | null;
  downMbps: number;
  upMbps: number;
  /** Median of the ping round trips, milliseconds. */
  latencyMs: number;
  testMb: number;
  createdAt: number;
}

/** One go-link as the Portkey management list shows it (PLAN-15). */
export interface Portkey {
  /** User-chosen memorable word; the immutable identity of the link. */
  slug: string;
  /** Normalized absolute http(s) target — any host. */
  url: string;
  note: string | null;
  /** Redirect count, incremented async after each hop. */
  hits: number;
  /** PLAN-06 device id; display names resolve client-side via core/devices. */
  authorDeviceId: string | null;
  createdAt: number;
  /** Epoch ms of the most recent redirect, or null if never used. */
  lastUsedAt: number | null;
}

/** One finished HTTP request, as the core HTTP layer saw it (PLAN-16b). */
export interface RequestCompletedEvent {
  /** The Fastify route TEMPLATE (`/api/downloads/:id/content`), or 'unmatched'. */
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
}

export interface BifrostEventMap {
  'file.uploaded': FileUploadedEvent;
  /** A staged upload was published to downloads/ — the banner, and only the banner. */
  'file.published': FilePublishedEvent;
  /**
   * Emitted by core/http for every finished request. It exists because the
   * latency histogram has to see EVERY route, and a Fastify hook added inside a
   * module's own plugin scope only ever sees that module's routes — the
   * composition root wraps each module in its own encapsulation context, so
   * even fastify-plugin would only lift a hook one level, to the wrapper. The
   * bus is the architecture's own answer to "one module needs to know what the
   * whole app is doing", and it keeps prom-client out of core.
   */
  'http.requestCompleted': RequestCompletedEvent;
  'download.added': DownloadEntry;
  'download.changed': DownloadEntry;
  'download.removed': DownloadEntry;
  'theme.updated': { themes: ThemeSummary[] };
  'settings.updated': SettingsUpdatedEvent;
  'clipboard.updated': ClipboardChange;
  'presence.changed': { devices: PresenceDevice[] };
  /** Emitted by Heimdall for the audit log; consumed only by audit-log. */
  'heimdall.login': { outcome: 'success' | 'failure' | 'locked'; ip: string };
  /** Create or update of a saved JSON document — libraries live-refresh from this. */
  'runestone.saved': { runestone: RunestoneSummary };
  'runestone.deleted': { id: string; name: string };
  /** Create or update of a saved Markdown document — Edda libraries live-refresh. */
  'edda.saved': { edda: EddaSummary };
  'edda.deleted': { id: string; name: string };
  /** A link was added to the read-later shelf — open shelves add the row live. */
  'accio.saved': { link: AccioLink };
  /**
   * An existing link changed: a user edit, or the async title enrichment
   * landing after the row was already broadcast. Same payload either way.
   */
  'accio.updated': { link: AccioLink };
  'accio.deleted': { id: string; url: string; title: string | null };
  /** A speed test finished and was saved — other open Nimbus pages add the row live. */
  'nimbus.completed': { result: NimbusResult };
  /** A go-link was created or edited — open management lists live-refresh. */
  'portkey.saved': { portkey: Portkey };
  'portkey.deleted': { slug: string; url: string };
  /**
   * A redirect happened: the hit count + last-used were bumped. Broadcast so
   * open management pages update within a heartbeat — deliberately NOT audited
   * (a hop happens constantly and says nothing about a person's action).
   */
  'portkey.hit': { portkey: Portkey };
  /** Loki execution/runner settings changed in Heimdall — open pages rebind. */
  'loki.settingsUpdated': LokiSettings;
  /** Screensaver (Nótt) settings changed in Heimdall — open clients rebind live. */
  'screensaver.settingsUpdated': ScreensaverSettings;
}

export type BifrostEventName = keyof BifrostEventMap;
