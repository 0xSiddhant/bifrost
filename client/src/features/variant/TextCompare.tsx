import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  MergeView,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { editorChrome } from '../../core/ui/JsonEditor';

/**
 * Bound the char-level Myers diff: two large, mostly-different documents
 * (think minified JSON on a single enormous line) otherwise freeze the tab
 * for minutes. Past the limit the diff falls back to a coarser but instant
 * line-level result — the right trade for a live view.
 */
export const TEXT_DIFF_CONFIG = { scanLimit: 500, timeout: 300 } as const;

/**
 * Variant's text mode (PLAN-08): @codemirror/merge gives pane alignment,
 * line diff, and char-level emphasis for free. Split view is two live
 * editable panes; unified is a single pane with inline deletions (the
 * mobile default). When normalization options are active the panes show
 * read-only normalized copies — honest about what is being compared.
 */

export interface TextCompareProps {
  left: string;
  right: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  view: 'split' | 'unified';
  wordWrap: boolean;
  /** Read-only normalized copies to compare instead of the live buffers. */
  normalized: { left: string; right: string } | null;
  height?: string;
  /** Bump after replacing a buffer externally (swap/import/clear) to rebuild. */
  resetToken?: number;
}

export interface TextCompareHandle {
  /** Scroll each side to a doc position (null = leave that side alone). */
  scrollToPositions(posA: number | null, posB: number | null): void;
  nextChunk(direction: 1 | -1): void;
}

export const TextCompare = forwardRef<TextCompareHandle, TextCompareProps>(function TextCompare(
  {
    left,
    right,
    onLeftChange,
    onRightChange,
    view,
    wordWrap,
    normalized,
    height = '58vh',
    resetToken = 0,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const unifiedRef = useRef<EditorView | null>(null);
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  const onLeftRef = useRef(onLeftChange);
  const onRightRef = useRef(onRightChange);
  leftRef.current = left;
  rightRef.current = right;
  onLeftRef.current = onLeftChange;
  onRightRef.current = onRightChange;

  const normalizedLeft = normalized ? normalized.left : null;
  const normalizedRight = normalized ? normalized.right : null;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const readOnly = normalizedLeft !== null;
    const docA = normalizedLeft ?? leftRef.current;
    const docB = normalizedRight ?? rightRef.current;

    const base = (onDoc: React.RefObject<(value: string) => void>) => [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      editorChrome(height),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !readOnly) onDoc.current(update.state.doc.toString());
      }),
    ];

    if (view === 'split') {
      const merge = new MergeView({
        a: { doc: docA, extensions: base(onLeftRef) },
        b: { doc: docB, extensions: base(onRightRef) },
        parent,
        gutter: true,
        highlightChanges: true,
        diffConfig: TEXT_DIFF_CONFIG,
      });
      mergeRef.current = merge;
      return () => {
        mergeRef.current = null;
        merge.destroy();
      };
    }

    const editor = new EditorView({
      state: EditorState.create({
        doc: docB,
        extensions: [
          ...base(onRightRef),
          unifiedMergeView({
            original: docA,
            mergeControls: false,
            gutter: true,
            highlightChanges: true,
            diffConfig: TEXT_DIFF_CONFIG,
          }),
        ],
      }),
      parent,
    });
    unifiedRef.current = editor;
    return () => {
      unifiedRef.current = null;
      editor.destroy();
    };
  }, [view, wordWrap, normalizedLeft, normalizedRight, height, resetToken]);

  useImperativeHandle(ref, () => ({
    scrollToPositions(posA, posB) {
      const merge = mergeRef.current;
      if (merge) {
        if (posA !== null) {
          merge.a.dispatch({
            effects: EditorView.scrollIntoView(Math.min(posA, merge.a.state.doc.length), {
              y: 'center',
            }),
          });
        }
        if (posB !== null) {
          merge.b.dispatch({
            effects: EditorView.scrollIntoView(Math.min(posB, merge.b.state.doc.length), {
              y: 'center',
            }),
          });
        }
        return;
      }
      const editor = unifiedRef.current;
      if (editor && posB !== null) {
        editor.dispatch({
          effects: EditorView.scrollIntoView(Math.min(posB, editor.state.doc.length), {
            y: 'center',
          }),
        });
      }
    },
    nextChunk(direction) {
      const target = mergeRef.current ? mergeRef.current.b : unifiedRef.current;
      if (!target) return;
      if (direction === 1) goToNextChunk(target);
      else goToPreviousChunk(target);
      target.focus();
    },
  }));

  return <div className="variant-textcompare" ref={containerRef} />;
});
