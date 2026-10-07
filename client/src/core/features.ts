/**
 * What this client ships (PLAN-35). Each feature is declared once: its id, the
 * first URL segments it owns, the nav category it sits under, and whether it
 * needs the hub. The hub build ships all of them; the standalone build only
 * those with `needsHub: false`.
 *
 * This replaces `GET /api/capabilities` **for the client**: nav, hub pages,
 * routes and Heimdall read this list instead of asking the server. The
 * server's `MANIFEST` is a different thing and stays: it decides what may be
 * *reached* on a given server, a security boundary no client build can be.
 *
 * Ids are the server module names the client used to look for in
 * `capabilities.modules`, so every gate keeps its meaning. A new feature
 * declares itself here, with `needsHub`, or it does not exist in either build.
 */

export type FeatureCategory = 'midgard' | 'ollivanders' | 'diagon-alley';

export type FeatureId =
  | 'file-transfer'
  | 'clipboard'
  | 'accio'
  | 'saga'
  | 'join'
  | 'pensieve'
  | 'runestone'
  | 'variant'
  | 'edda'
  | 'groot'
  | 'atlas'
  | 'loki'
  | 'brotli'
  | 'toolbox'
  | 'nimbus'
  | 'portkey'
  | 'wardens'
  | 'guide';

export interface Feature {
  id: FeatureId;
  label: string;
  /** First URL segments this feature owns, with the leading slash. */
  roots: string[];
  /** The nav tab it lives under, or null for one reached another way. */
  category: FeatureCategory | null;
  /** True when it cannot work without the Bifrost server. */
  needsHub: boolean;
}

export const FEATURES: readonly Feature[] = [
  // Midgard: the transfer doors. Saga presents a dropped file with no server.
  {
    id: 'file-transfer',
    label: 'Send and receive',
    roots: ['/upload', '/downloads'],
    category: 'midgard',
    needsHub: true,
  },
  {
    id: 'clipboard',
    label: 'Hermes',
    roots: ['/hermes', '/muninn'],
    category: 'midgard',
    needsHub: true,
  },
  { id: 'accio', label: 'Accio', roots: ['/accio'], category: 'midgard', needsHub: true },
  { id: 'saga', label: 'Saga', roots: ['/saga'], category: 'midgard', needsHub: false },
  // The Join Bifrost band: a QR of the server's own URL.
  { id: 'join', label: 'Join Bifrost', roots: [], category: 'midgard', needsHub: true },

  // Ollivanders: the editors work in the browser; their libraries need the hub.
  {
    id: 'pensieve',
    label: 'Pensieve',
    roots: ['/pensieve'],
    category: 'ollivanders',
    needsHub: true,
  },
  {
    id: 'runestone',
    label: 'Runestone',
    roots: ['/runestone'],
    category: 'ollivanders',
    needsHub: false,
  },
  {
    id: 'variant',
    label: 'Variant',
    roots: ['/variant'],
    category: 'ollivanders',
    needsHub: false,
  },
  { id: 'edda', label: 'Edda', roots: ['/edda'], category: 'ollivanders', needsHub: false },
  { id: 'groot', label: 'Groot', roots: ['/groot'], category: 'ollivanders', needsHub: false },
  { id: 'atlas', label: 'Atlas', roots: ['/atlas'], category: 'ollivanders', needsHub: false },
  { id: 'loki', label: 'Loki', roots: ['/loki'], category: 'ollivanders', needsHub: false },
  // Brotli compresses on the server: browsers' CompressionStream has no Brotli.
  { id: 'brotli', label: 'Brotli', roots: ['/brotli'], category: 'ollivanders', needsHub: true },

  // Diagon Alley: the in-place tools are pure client; Nimbus and Portkey are not.
  {
    id: 'toolbox',
    label: 'Toolbox',
    roots: ['/diagon-alley', '/sigil'],
    category: 'diagon-alley',
    needsHub: false,
  },
  { id: 'nimbus', label: 'Nimbus', roots: ['/nimbus'], category: 'diagon-alley', needsHub: true },
  {
    id: 'portkey',
    label: 'Portkey',
    roots: ['/portkey'],
    category: 'diagon-alley',
    needsHub: true,
  },

  // Reached from elsewhere, not from a tab.
  { id: 'wardens', label: 'Wardens', roots: ['/wardens'], category: null, needsHub: true },
  { id: 'guide', label: 'Guide', roots: [], category: null, needsHub: false },
];

export const HUB_FEATURES: readonly Feature[] = FEATURES;
export const STANDALONE_FEATURES: readonly Feature[] = FEATURES.filter(
  (feature) => !feature.needsHub,
);

/** The features this build ships. */
export const ACTIVE_FEATURES: readonly Feature[] =
  __BIFROST_BUILD__ === 'standalone' ? STANDALONE_FEATURES : HUB_FEATURES;

const ACTIVE_IDS = new Set<string>(ACTIVE_FEATURES.map((feature) => feature.id));

/** Whether this build ships the feature. Takes a plain string, as the old module checks did. */
export function hasFeature(id: string): boolean {
  return ACTIVE_IDS.has(id);
}

/** Whether a nav category has anything to show in this build. */
export function hasCategory(category: FeatureCategory): boolean {
  return ACTIVE_FEATURES.some((feature) => feature.category === category);
}

/**
 * Paths the hub's server answers that the standalone app can only explain:
 * an API call, a go-link, a document's raw endpoint. The container's fallback
 * hands them to the app, which shows the Bifröst sheet.
 */
const SERVER_PATH = /^\/(api|go)(\/|$)|^\/(runestone|edda|groot|atlas)\/api(\/|$)/;

/**
 * Whether a path needs the hub: a server path, or one owned by a feature this
 * build does not ship. Used by the standalone router to show the sheet as the
 * page instead of a 404.
 */
export function needsHubForPath(pathname: string): boolean {
  if (SERVER_PATH.test(pathname)) return true;
  const owner = FEATURES.find((feature) =>
    feature.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  );
  return owner !== undefined && !hasFeature(owner.id);
}
