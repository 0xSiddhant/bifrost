import type { ReactNode } from 'react';

/** The formats the app has an editor for. One more is one more registry entry. */
export type ContentFormatKind = 'json' | 'xml' | 'yaml' | 'markdown';

export interface ContentFormatEntry {
  kind: ContentFormatKind;
  /** Chip text — the **format**, not the tool: "JSON", not "Runestone". */
  label: string;
  /** Button copy: "Open in Runestone". */
  toolName: string;
  /** Capability module that must be loaded for this offer to exist at all. */
  module: string;
  route: string;
  icon: ReactNode;
  /**
   * A real structural check, never "did it parse". The offer is meant to appear
   * only for content one of these editors genuinely understands, so a test that
   * anything could pass would make the button meaningless.
   */
  test(text: string): boolean;
  /** Hands the text to that tool through its own one-shot session seed. */
  seed(text: string): void;
}
