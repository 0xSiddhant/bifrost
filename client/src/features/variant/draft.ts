import type { DraftCodec } from '../../core/drafts/records';
import {
  DEFAULT_JSON_OPTIONS,
  DEFAULT_TEXT_OPTIONS,
  type VariantJsonOptions,
  type VariantTextOptions,
} from './compare';

/**
 * What Variant keeps per tab (PLAN-43): both workspaces, JSON and text, each
 * pane's text, label and Pensieve source, and the options. Never the compare
 * results: they describe the buffers at the moment Compare was pressed, and
 * the person presses it again after a restore.
 */

export type VariantMode = 'json' | 'text';

export interface VariantPaneDraft {
  text: string;
  label: string;
  source: { slug: string; name: string } | null;
}

export interface VariantDraft {
  mode: VariantMode;
  json: { left: VariantPaneDraft; right: VariantPaneDraft };
  text: { left: VariantPaneDraft; right: VariantPaneDraft };
  jsonOptions: VariantJsonOptions;
  textOptions: VariantTextOptions;
}

function asPane(raw: unknown): VariantPaneDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const pane = raw as Partial<VariantPaneDraft>;
  if (typeof pane.text !== 'string' || typeof pane.label !== 'string') return null;
  let source: VariantPaneDraft['source'] = null;
  if (pane.source !== null && pane.source !== undefined) {
    const candidate = pane.source as Partial<NonNullable<VariantPaneDraft['source']>>;
    if (typeof candidate.slug !== 'string' || typeof candidate.name !== 'string') return null;
    source = { slug: candidate.slug, name: candidate.name };
  }
  return { text: pane.text, label: pane.label, source };
}

function asSides(raw: unknown): VariantDraft['json'] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const sides = raw as { left?: unknown; right?: unknown };
  const left = asPane(sides.left);
  const right = asPane(sides.right);
  return left && right ? { left, right } : null;
}

/** Keep each option that still has its expected type; the rest fall back to the defaults. */
function mergeOptions<T extends object>(defaults: T, raw: unknown): T {
  if (typeof raw !== 'object' || raw === null) return { ...defaults };
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === typeof fallback) merged[key] = value;
  }
  return merged as T;
}

export const variantDraftCodec: DraftCodec<VariantDraft> = (raw) => {
  if (typeof raw !== 'object' || raw === null) return null;
  const draft = raw as Partial<Record<keyof VariantDraft, unknown>>;
  const json = asSides(draft.json);
  const text = asSides(draft.text);
  if (!json || !text) return null;
  const jsonOptions = mergeOptions(DEFAULT_JSON_OPTIONS, draft.jsonOptions);
  if (!['index', 'key', 'set'].includes(jsonOptions.arrayStrategy)) {
    jsonOptions.arrayStrategy = DEFAULT_JSON_OPTIONS.arrayStrategy;
  }
  return {
    mode: draft.mode === 'text' ? 'text' : 'json',
    json,
    text,
    jsonOptions,
    textOptions: mergeOptions(DEFAULT_TEXT_OPTIONS, draft.textOptions),
  };
};

/** Anything typed in any of the four panes. */
export function variantHasContent(draft: VariantDraft): boolean {
  return [draft.json.left, draft.json.right, draft.text.left, draft.text.right].some(
    (pane) => pane.text.trim() !== '',
  );
}
