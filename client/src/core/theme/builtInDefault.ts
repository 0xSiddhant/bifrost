/**
 * The theme a first visit lands on when the visitor has not picked one and the
 * household has set no default (Heimdall's "Default theme", hub only): the
 * owner's pick, ahead of the device's colour scheme, in either scheme. `null`
 * hands the choice back to the colour-scheme match.
 *
 * One constant for the runtime (`resolveThemeChoice`) and the build's first
 * paint (`seoBuild.ts`), so the two cannot disagree; `themes.test.ts` checks it
 * names a bundled theme.
 */
export const BUILT_IN_DEFAULT_THEME: string | null = 'halloween';
