import { createTwoFilesPatch } from 'diff';
import { diffJson, type DiffRecord } from '../../core/json/diff';
import { applyJsonPatch, toJsonPatch } from '../../core/json/jsonPatch';
import { toDiffOptions, type VariantJsonOptions } from './compare';

/**
 * Variant's two file exports (PLAN-26). Both are pure client compute — the
 * `variant` server module stays the capability-only no-op it has always been.
 *
 * JSON mode produces an RFC 6902 patch; text mode produces a unified diff
 * shaped the way `git diff` itself shapes one. Neither invents a format: the
 * point is that the file opens correctly in a tool that already reads one.
 */

export type ExportResult =
  { ok: true; filename: string; content: string; mime: string } | { ok: false; reason: string };

/** Pane label → a token safe for a filename and for a diff header path. */
function safeLabel(label: string, fallback: string): string {
  // Strips path separators and control characters — tabs included, which the
  // header format below relies on staying out of the label itself.
  // eslint-disable-next-line no-control-regex
  const safe = label.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim();
  return safe || fallback;
}

// ── JSON mode: RFC 6902 ─────────────────────────────────────────────────────

const BLOCKED =
  'This diff can’t be exported as one sequential patch — replaying it didn’t reproduce the right-hand side. Try the “index” array strategy.';

export interface JsonPatchExportInput {
  records: readonly DiffRecord[];
  /** The compared documents, exactly as the compare that produced `records` saw them. */
  leftText: string;
  rightText: string;
  /** The same options that compare ran under — the replay check honours them. */
  options: VariantJsonOptions;
  leftLabel: string;
  rightLabel: string;
}

/**
 * Turn a finished compare into a downloadable JSON Patch — but only after
 * proving the patch actually works.
 *
 * The generated ops are replayed against the real left document and the result
 * is compared to the real right document **by re-running the diff under the
 * user's own options**, rather than by a plain deep-equal. That distinction
 * matters: with an epsilon, an ignore-path glob or case-insensitive strings
 * set, the walker deliberately does not report some real differences, so a
 * patch that correctly omits them would fail a literal equality check and be
 * blocked for no reason. An empty re-diff asks the honest question — does this
 * patch reproduce everything the compare itself called a difference?
 */
export function exportJsonPatch(input: JsonPatchExportInput): ExportResult {
  const ops = toJsonPatch(input.records);
  if (ops.length === 0) {
    return {
      ok: false,
      reason: 'These documents are structurally identical; JSON Patch has nothing to export.',
    };
  }

  let left: unknown;
  let right: unknown;
  try {
    left = JSON.parse(input.leftText) as unknown;
    right = JSON.parse(input.rightText) as unknown;
  } catch {
    // Unreachable through the UI — a compare only produces records once both
    // sides parsed — but a stale-results race must not hand over an
    // unverified file.
    return { ok: false, reason: 'Both sides must be valid JSON to export a patch.' };
  }

  try {
    const replayed = applyJsonPatch(left, ops);
    if (diffJson(replayed, right, toDiffOptions(input.options)).length > 0) {
      return { ok: false, reason: BLOCKED };
    }
  } catch {
    // applyJsonPatch throws when an operation does not fit the document it is
    // handed — exactly the "cannot be expressed as one sequential patch" case.
    return { ok: false, reason: BLOCKED };
  }

  const leftName = safeLabel(input.leftLabel, 'original');
  const rightName = safeLabel(input.rightLabel, 'modified');
  return {
    ok: true,
    filename: `${leftName}-to-${rightName}.patch.json`,
    content: `${JSON.stringify(ops, null, 2)}\n`,
    mime: 'application/json-patch+json',
  };
}

// ── Text mode: unified diff ─────────────────────────────────────────────────

export interface UnifiedDiffExportInput {
  /** The **normalized** snapshots `compareText` produced, not the raw panes. */
  leftText: string;
  rightText: string;
  leftLabel: string;
  rightLabel: string;
}

/**
 * Build a unified diff shaped like `git diff --no-index`'s own output. Three
 * things came out of reading what `diff` actually emits, rather than assuming:
 *
 * 1. `createTwoFilesPatch` still prints a `===…===` separator line (a classic
 *    POSIX-patch convention git never emits) — stripped here.
 * 2. `git apply` **rejects** a patch whose two sides are named differently
 *    unless a `diff --git a/… b/…` line precedes the headers, and differently
 *    named sides are Variant's normal case ("Original" vs "Modified"). Git
 *    emits that line itself; so does this.
 * 3. Git terminates a header path containing a space with a tab. Without it,
 *    POSIX `patch -p1` truncates the path at the space and cannot find the
 *    file — and pane labels come from filenames and Pensieve document names,
 *    so spaces are ordinary here.
 */
export function buildUnifiedDiff(
  leftText: string,
  rightText: string,
  leftName: string,
  rightName: string,
): string {
  const a = `a/${leftName}`;
  const b = `b/${rightName}`;
  const body = createTwoFilesPatch(a, b, leftText, rightText, undefined, undefined).replace(
    /^={5,}\n/,
    '',
  );
  // Function replacements: a label may legitimately contain `$`.
  const headed = body
    .replace(`--- ${a}\n`, () => `--- ${a}${/\s/.test(leftName) ? '\t' : ''}\n`)
    .replace(`+++ ${b}\n`, () => `+++ ${b}${/\s/.test(rightName) ? '\t' : ''}\n`);
  return `diff --git ${a} ${b}\n${headed}`;
}

/**
 * Export the text-mode compare as a `.patch` file.
 *
 * This runs its own diff pass rather than reusing `@codemirror/merge`'s
 * on-screen chunks: those carry changed-line ranges, not the context lines,
 * hunk merging and `@@` headers a unified diff file is made of. Two correct
 * Myers implementations can group a given pair of texts slightly differently
 * at the margins, so the exported hunks are not guaranteed byte-identical in
 * grouping to what is painted on screen — the change they describe is the
 * same. It compares the **normalized** snapshots, so whatever trim/case/
 * whitespace options are set apply to the export exactly as they did on screen.
 */
export function exportUnifiedDiff(input: UnifiedDiffExportInput): ExportResult {
  if (input.leftText === input.rightText) {
    return { ok: false, reason: 'Both sides are identical; there are no hunks to export.' };
  }
  const leftName = safeLabel(input.leftLabel, 'original');
  const rightName = safeLabel(input.rightLabel, 'modified');
  return {
    ok: true,
    filename: `${leftName}-to-${rightName}.patch`,
    content: buildUnifiedDiff(input.leftText, input.rightText, leftName, rightName),
    mime: 'text/x-patch',
  };
}

// ── handing the file to the browser ─────────────────────────────────────────

/** Blob + a temporary download anchor — the one mechanism a client-side save has. */
export function downloadExport(result: Extract<ExportResult, { ok: true }>): void {
  const blob = new Blob([result.content], { type: result.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
