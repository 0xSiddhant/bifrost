import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import {
  MergeView,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { editorChrome } from '../../core/ui/JsonEditor';
import { TEXT_DIFF_CONFIG } from './compare';

/**
 * Variant's text-mode *result* view (PLAN-08): a read-only @codemirror/merge
 * render of the snapshots taken when Compare was clicked. Diffing never runs
 * per keystroke (owner's model — performance); editing happens in the plain
 * panes, this view only displays a finished compare.
 */

export interface TextCompareProps {
  /** The compared (already normalized) snapshots. */
  left: string;
  right: string;
  view: 'split' | 'unified';
  wordWrap: boolean;
  height?: string;
}

export interface TextCompareHandle {
  /** Scroll each side to a doc position (null = leave that side alone). */
  scrollToPositions(posA: number | null, posB: number | null): void;
  nextChunk(direction: 1 | -1): void;
}

export const TextCompare = forwardRef<TextCompareHandle, TextCompareProps>(function TextCompare(
  { left, right, view, wordWrap, height = '56vh' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const unifiedRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const base = [
      lineNumbers(),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      editorChrome(height),
    ];

    if (view === 'split') {
      const merge = new MergeView({
        a: { doc: left, extensions: base },
        b: { doc: right, extensions: base },
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
        doc: right,
        extensions: [
          ...base,
          unifiedMergeView({
            original: left,
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
  }, [left, right, view, wordWrap, height]);

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
    },
  }));

  return <div className="variant-textcompare" ref={containerRef} />;
});
