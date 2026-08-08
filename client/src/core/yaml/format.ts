import { isCollection, visit } from 'yaml';
import { parseYamlDocuments } from './parse';
import { isValidYaml } from './validate';

/**
 * `lineWidth: 0` disables folding long lines. A formatter that re-wraps a long
 * plain scalar changes where its line breaks are, and in YAML a fold inside a
 * plain scalar is *significant to nothing* but reads as an edit in every diff
 * the user later takes — so the safe default is to leave lines alone.
 */
const STRINGIFY = { indent: 2, lineWidth: 0 } as const;

/**
 * Straight concatenation, deliberately: each document's `toString` already
 * emits its own `---` marker exactly when the source had one, so re-adding it
 * here doubles every separator. (Found by testing — the first version added
 * them and turned a two-document stream into four markers.)
 */
function joinDocuments(parts: string[]): string {
  return parts.map((part) => (part.endsWith('\n') ? part : `${part}\n`)).join('');
}

/**
 * Format through the **document model**, never through parse + stringify.
 *
 * `parse()` returns plain JS, which has nowhere to keep a comment, so the
 * obvious implementation silently deletes every one of them — for a config file
 * that is data loss with no error. `parseDocument().toString()` keeps head,
 * key-level and trailing comments in position, which is PLAN-19's criterion 2.
 *
 * An unparseable document is returned **unchanged**: formatting is not a repair
 * tool, and emitting a half-understood document over the user's text is the one
 * outcome worse than doing nothing.
 */
export function formatYaml(text: string): string {
  if (!isValidYaml(text)) return text;
  const docs = parseYamlDocuments(text);
  if (docs.length === 0) return text;
  return joinDocuments(docs.map((doc) => doc.toString(STRINGIFY)));
}

/** Set `flow` on every collection in every document, then re-emit. */
function withFlow(text: string, flow: boolean): string {
  if (!isValidYaml(text)) return text;
  const docs = parseYamlDocuments(text);
  if (docs.length === 0) return text;
  for (const doc of docs) {
    visit(doc, (_key, node) => {
      if (isCollection(node)) node.flow = flow;
    });
  }
  return joinDocuments(docs.map((doc) => doc.toString(STRINGIFY)));
}

/**
 * Flow style — `{a: 1, b: [2, 3]}`. YAML's analogue of JSON minify.
 *
 * Comments do **not** survive this one, and that is the format's doing rather
 * than a shortcut here: flow style has nowhere to put a line comment, so the
 * emitter drops them. The UI says so before the user presses it.
 */
export const toFlow = (text: string): string => withFlow(text, true);

/** Block style — the indented form. The analogue of beautify. */
export const toBlock = (text: string): string => withFlow(text, false);
