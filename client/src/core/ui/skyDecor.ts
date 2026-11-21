/**
 * The sky's decoration chunk (PLAN-41, extended for the Yule world): the relic
 * drawings, and the decorations a theme opts into (falling snow, the string
 * lights under the header, the footer's winter scene). One chunk, loaded once
 * the browser is idle after the first paint, with each piece's stylesheet, so
 * none of it is in the first load. `SkyRelics.tsx` mounts the pieces.
 */
export { RelicScatter } from './RelicScatter';
export { Snowfall } from './Snowfall';
export { StringLights } from './StringLights';
export { FooterScene } from './FooterScene';
