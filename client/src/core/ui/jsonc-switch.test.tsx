// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JsonEditor, type EditorMode, type JsonEditorHandle } from './JsonEditor';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * Runestone's JSON/JSONC switch (PLAN-42) changes the editor's language, and
 * nothing else: the same editor stays mounted with its text and undo history.
 */
describe('JsonEditor mode switch', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout; CodeMirror measures text ranges after an edit.
    const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
    Range.prototype.getClientRects = empty as unknown as () => DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reconfigures in place, keeping the buffer and the undo history', async () => {
    const ref = createRef<JsonEditorHandle>();
    const onChange = vi.fn();
    const render = async (mode: EditorMode, value: string) => {
      await act(async () => {
        root.render(<JsonEditor ref={ref} value={value} mode={mode} onChange={onChange} />);
      });
    };

    await render('json', '{"a": 1}');
    const editor = container.querySelector('.cm-editor');
    await act(async () => ref.current?.replaceRange(1, 1, ' // note\n'));
    const edited = '{ // note\n"a": 1}';
    expect(onChange).toHaveBeenLastCalledWith(edited);

    await render('jsonc', edited);
    expect(container.querySelector('.cm-editor')).toBe(editor);
    expect(container.querySelector('.cm-content')?.textContent).toContain('// note');

    await act(async () => ref.current?.undo());
    expect(onChange).toHaveBeenLastCalledWith('{"a": 1}');

    // And back again: still the same editor.
    await render('json', '{"a": 1}');
    expect(container.querySelector('.cm-editor')).toBe(editor);
  });
});
