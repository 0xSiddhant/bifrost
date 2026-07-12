/**
 * One source of truth for cross-module event names and payloads.
 * Feature plans extend this map (dot-namespaced: `file.uploaded`,
 * `download.added`, `clipboard.updated`, ...). Empty until PLAN-02.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BifrostEventMap {}

export type BifrostEventName = keyof BifrostEventMap;
