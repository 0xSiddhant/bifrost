/// <reference types="vite/client" />

/** Which client this is (PLAN-35): `vite build --mode standalone` makes the standalone one. */
declare const __BIFROST_BUILD__: import('../buildDefaults').Build;
/** `__BIFROST_BUILD__ === 'hub'`, as a literal the bundler folds: `__HUB__ ? hubCode : stub`. */
declare const __HUB__: boolean;
/** Caps, Loki, Nótt and Heimdall-access defaults baked in from the repo-root `.env`. */
declare const __BIFROST_DEFAULTS__: import('../buildDefaults').BuildDefaults;
/** This client's own version, commit and build time (Heimdall's About on the standalone site). */
declare const __BIFROST_CLIENT__: { version: string; commit: string; builtAt: string };
