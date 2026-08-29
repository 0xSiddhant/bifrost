// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { analyzeXml, detectIndentUnit } from '../xml';
import { nodeAtPath, type XmlChange } from '../xml/plist';
import {
  base64Bytes,
  localInputToPlistDate,
  PlistTable,
  plistDateToLocalInput,
  stepValue,
} from './PlistTable';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>Name</key>
\t<string>Bifrost</string>
\t<key>Build</key>
\t<integer>3</integer>
\t<key>Hidden</key>
\t<true/>
\t<key>Nested</key>
\t<dict>
\t\t<key>Inner</key>
\t\t<string>deep</string>
\t</dict>
\t<key>Seeds</key>
\t<array>
\t\t<string>alpha</string>
\t\t<string>beta</string>
\t\t<string>gamma</string>
\t</array>
</dict>
</plist>
`;

describe('PlistTable', () => {
  let container: HTMLDivElement;
  let root: Root;
  let changes: XmlChange[];
  let revealed: number[];
  let text: string;

  /** Render the table over `text`, as AtlasPage does after each analysis. */
  function render(source = text) {
    text = source;
    const analysis = analyzeXml(source);
    const tree = analysis.plist;
    if (!tree) throw new Error(`no plist tree: ${analysis.plistError ?? 'unknown'}`);
    act(() => {
      root.render(
        <PlistTable
          root={tree}
          title="Bundle Info"
          onEdit={(edit) => {
            // Exactly what AtlasPage does: re-parse the live buffer, find the
            // node again by path, and let the edit compute against fresh spans.
            const live = analyzeXml(text);
            const node = live.plist && nodeAtPath(live.plist, edit.path);
            const change = node ? edit.apply(node, text, detectIndentUnit(text)) : null;
            if (change) changes.push(change);
          }}
          onReveal={(offset) => revealed.push(offset)}
        />,
      );
    });
  }

  /** Apply the last change the way the code pane's `replaceRange` does. */
  const applied = (): string => {
    const change = changes[changes.length - 1];
    if (!change) throw new Error('no change was emitted');
    return text.slice(0, change.from) + change.insert + text.slice(change.to);
  };

  const rows = (): HTMLElement[] =>
    [...container.querySelectorAll('[role="row"]')].filter(
      (row) => !row.classList.contains('plist-row--head'),
    ) as HTMLElement[];

  const rowWith = (label: string): HTMLElement => {
    const hit = rows().find((row) => row.textContent?.includes(label));
    if (!hit) throw new Error(`no row containing "${label}"`);
    return hit;
  };

  const click = (element: Element | null | undefined) => {
    if (!element) throw new Error('nothing to click');
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  /**
   * React keeps its own value tracker on a controlled input and drops an event
   * whose value it believes unchanged — so the native setter has to be used
   * (the same idiom `PensievePage.test` already needs).
   */
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        value,
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  /** Drive a native <select> the way React's onChange sees it. */
  const choose = (select: HTMLSelectElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        select,
        value,
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

  // React delegates onBlur from `focusout`, not `blur` — a bubbling `blur`
  // reaches nothing.
  const blur = (input: HTMLInputElement) =>
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    changes = [];
    revealed = [];
    text = PLIST;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the header, the shaded root row and one row per entry', () => {
    render();
    const header = container.querySelector('.plist-row--head');
    expect(header?.textContent).toContain('Key');
    expect(header?.textContent).toContain('Type');
    expect(header?.textContent).toContain('Value');

    const rootRow = container.querySelector('.plist-row--root');
    expect(rootRow?.textContent).toContain('Bundle Info');
    // Item count instead of an editable value, and a Type control that cannot
    // be changed — a plist's body type is whatever it is.
    expect(rootRow?.textContent).toContain('(5 items)');
    expect(rootRow?.querySelector('.plist-typelabel')?.textContent).toBe('Dictionary');
    expect(rootRow?.querySelector('.plist-typelabel')?.classList).toContain('is-disabled');

    // Root open, nested containers closed: five entries plus the root row.
    expect(rows()).toHaveLength(6);
  });

  it('shows the declared type of every row, keeping integer apart from real', () => {
    render(
      '<plist version="1.0"><dict><key>a</key><integer>1</integer><key>b</key><real>1</real></dict></plist>',
    );
    // The root keeps a plain, unchangeable label; every other row is a popup.
    expect(container.querySelector('.plist-typelabel')?.textContent).toBe('Dictionary');
    const chosen = [...container.querySelectorAll('.plist-typeselect__input')].map(
      (element) => (element as HTMLSelectElement).value,
    );
    expect(chosen).toEqual(['integer', 'real']);
  });

  it('expands and collapses a nested dict', () => {
    render();
    expect(container.textContent).not.toContain('Inner');
    click(rowWith('Nested').querySelector('.plist-disclosure'));
    expect(container.textContent).toContain('Inner');
    click(rowWith('Nested').querySelector('.plist-disclosure'));
    expect(container.textContent).not.toContain('Inner');
  });

  it('renders booleans as the literal words YES and NO, and toggles them', () => {
    render();
    const bool = rowWith('Hidden').querySelector('.plist-bool');
    expect(bool?.textContent).toBe('YES');
    expect(rowWith('Hidden').querySelector('input[type="checkbox"]')).toBeNull();

    click(bool);
    expect(applied()).toContain('<key>Hidden</key>\n\t<false/>');
  });

  it('commits a value edit on blur as a surgical span-only change', () => {
    render();
    const input = rowWith('Name').querySelector('.plist-input') as HTMLInputElement;
    type(input, 'Heimdall');
    // Nothing is dispatched while typing — one transaction per character would
    // flood the undo history.
    expect(changes).toHaveLength(0);

    blur(input);
    expect(changes).toHaveLength(1);
    const next = applied();
    expect(next).toBe(PLIST.replace('<string>Bifrost</string>', '<string>Heimdall</string>'));
    // Asserted against the surrounding text, not just the re-parsed result.
    const at = PLIST.indexOf('<string>Bifrost');
    expect(next.slice(0, at)).toBe(PLIST.slice(0, at));
  });

  it('changes a row’s type from the dropdown, converting sensibly', () => {
    render();
    const select = rowWith('Build').querySelector(
      '.plist-typeselect__input',
    ) as HTMLSelectElement;
    // Every type is one selection away — the whole reason this is a popup and
    // not a stepper.
    expect([...select.options].map((option) => option.value)).toEqual([
      'array',
      'boolean',
      'data',
      'date',
      'dict',
      'integer',
      'real',
      'string',
    ]);
    choose(select, 'real');
    expect(applied()).toBe(PLIST.replace('<integer>3</integer>', '<real>3</real>'));
  });

  it('emits nothing when the type picked is the one already set', () => {
    render();
    const select = rowWith('Build').querySelector(
      '.plist-typeselect__input',
    ) as HTMLSelectElement;
    choose(select, 'integer');
    expect(changes).toEqual([]);
  });

  it('puts the chevron inside the type control, not beside it', () => {
    render();
    const wrap = rowWith('Build').querySelector('.plist-typeselect');
    const select = wrap?.querySelector('.plist-typeselect__input');
    const chevron = wrap?.querySelector('.plist-typeselect__chevron');
    // The glyph is the part that reads as the affordance, so it has to open
    // the menu too. The CSS lays it over the select and makes it
    // click-through; this pins the markup that arrangement depends on, since
    // jsdom loads no stylesheet and cannot see `pointer-events` itself. That
    // a tap at the glyph's own coordinates lands on the select is proven live.
    expect(select).toBeTruthy();
    expect(chevron).toBeTruthy();
    expect(chevron?.closest('.plist-typeselect')).toBe(wrap);
    // Decorative only — it must never become a second, separate control.
    expect(chevron?.tagName).toBe('svg');
    expect(wrap?.querySelectorAll('button')).toHaveLength(0);
  });

  it('leaves the root’s type unchangeable', () => {
    render();
    const rootRow = container.querySelector('.plist-row--root');
    expect(rootRow?.querySelector('.plist-typeselect__input')).toBeNull();
    expect(rootRow?.querySelector('.plist-typelabel')?.classList).toContain('is-disabled');
  });

  it('adds an entry to the container whose "+" was pressed', () => {
    render();
    click(rowWith('Bundle Info').querySelector('.plist-action'));
    const next = applied();
    expect(next).toContain('<key>New item</key>');
    // The five existing entries are untouched, byte for byte.
    const upTo = PLIST.indexOf('</array>') + '</array>'.length;
    expect(next.slice(0, upTo)).toBe(PLIST.slice(0, upTo));
  });

  it('deletes exactly the target entry', () => {
    render();
    const actions = rowWith('Build').querySelectorAll('.plist-action');
    click(actions[0]);
    expect(applied()).toBe(PLIST.replace('\n\t<key>Build</key>\n\t<integer>3</integer>', ''));
  });

  it('renames a key on double-click, and lets a collision through to the rail', () => {
    render();
    // Held across the edit: once the cell becomes an input, its text lives in
    // `value` and `textContent` can no longer find the row.
    const buildRow = rowWith('Build');
    act(() => {
      buildRow
        .querySelector('.plist-keybtn')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = buildRow.querySelector('.plist-input--key') as HTMLInputElement;
    expect(input).toBeTruthy();
    type(input, 'Name');
    blur(input);

    const next = applied();
    const after = analyzeXml(next);
    // No dialog, no refusal: the document is valid and the advisory says why
    // it might not be what the author meant.
    expect(after.stats.valid).toBe(true);
    expect(after.advisories.map((advisory) => advisory.kind)).toContain('duplicate-key');
  });

  it('jumps to a node’s source on a single click, without entering edit mode', () => {
    render();
    click(rowWith('Name').querySelector('.plist-keybtn'));
    expect(revealed).toEqual([PLIST.indexOf('<string>Bifrost</string>')]);
    expect(rowWith('Name').querySelector('.plist-input--key')).toBeNull();

    // Array items jump from their position label too, having no key to click.
    click(rowWith('Seeds').querySelector('.plist-disclosure'));
    click(rowWith('Item 1').querySelector('.plist-keybtn'));
    expect(revealed).toHaveLength(2);
    expect(changes).toEqual([]);
  });

  it('labels array items by position and gives them no key editor', () => {
    render();
    click(rowWith('Seeds').querySelector('.plist-disclosure'));
    expect(container.textContent).toContain('Item 0');
    expect(container.textContent).toContain('Item 2');
  });

  it('reorders a row by pointer drag, touching nothing else', () => {
    render();
    click(rowWith('Seeds').querySelector('.plist-disclosure'));
    // Array rows are labelled by position; their values live in input `value`,
    // which `textContent` never sees.
    const alpha = rowWith('Item 0');
    const gamma = rowWith('Item 2');

    // jsdom lays nothing out, so each row's box is the drag's only input.
    const boxes = new Map<HTMLElement, DOMRect>([
      [alpha, { top: 100, bottom: 120 } as DOMRect],
      [rowWith('Item 1'), { top: 120, bottom: 140 } as DOMRect],
      [gamma, { top: 140, bottom: 160 } as DOMRect],
    ]);
    for (const [element, rect] of boxes) element.getBoundingClientRect = () => rect;

    const grip = gamma.querySelector('.plist-grip') as HTMLElement;
    grip.setPointerCapture = () => {};
    grip.hasPointerCapture = () => false;

    const pointer = (type: string, clientY: number) =>
      act(() => {
        grip.dispatchEvent(new PointerEvent(type, { clientY, bubbles: true, pointerId: 1 }));
      });

    pointer('pointerdown', 150);
    pointer('pointermove', 110);
    pointer('pointerup', 110);

    const next = applied();
    expect(analyzeXml(next).plist?.children[4]?.children.map((child) => child.value)).toEqual([
      'gamma',
      'alpha',
      'beta',
    ]);
    // Everything outside the array is byte-identical.
    const head = PLIST.indexOf('<array>') + '<array>'.length;
    expect(next.slice(0, head)).toBe(PLIST.slice(0, head));
    expect(next.slice(next.indexOf('</array>'))).toBe(PLIST.slice(PLIST.indexOf('</array>')));
  });

  it('reorders inside a dict too, carrying the key with the value', () => {
    render();
    const name = rowWith('Name');
    const build = rowWith('Build');
    const hidden = rowWith('Hidden');
    const boxes = new Map<HTMLElement, DOMRect>([
      [name, { top: 100, bottom: 120 } as DOMRect],
      [build, { top: 120, bottom: 140 } as DOMRect],
      [hidden, { top: 140, bottom: 160 } as DOMRect],
      [rowWith('Nested'), { top: 160, bottom: 180 } as DOMRect],
      [rowWith('Seeds'), { top: 180, bottom: 200 } as DOMRect],
    ]);
    for (const [element, rect] of boxes) element.getBoundingClientRect = () => rect;

    const grip = name.querySelector('.plist-grip') as HTMLElement;
    grip.setPointerCapture = () => {};
    grip.hasPointerCapture = () => false;
    // One act per event: batched together, the move would still see the state
    // from before the press.
    const pointer = (kind: string, clientY: number) =>
      act(() => {
        grip.dispatchEvent(new PointerEvent(kind, { clientY, bubbles: true, pointerId: 1 }));
      });
    pointer('pointerdown', 110);
    pointer('pointermove', 130);
    pointer('pointerup', 130);

    expect(analyzeXml(applied()).plist?.children.map((child) => child.key)).toEqual([
      'Build',
      'Name',
      'Hidden',
      'Nested',
      'Seeds',
    ]);
  });

  it('uses the live buffer’s offsets when the document moved since the parse', () => {
    render();
    // A keystroke in the code pane lands before the table's debounced analysis
    // catches up: every offset the table is holding is now short by the length
    // of the inserted comment. (After the declaration, not before it — an XML
    // declaration has to be the very first thing in the document.)
    text = PLIST.replace(
      '<plist version="1.0">',
      '<!-- typed while the table was open -->\n<plist version="1.0">',
    );

    click(rowWith('Hidden').querySelector('.plist-bool'));
    const next = applied();
    expect(next).toBe(text.replace('<true/>', '<false/>'));
    expect(next).toContain('<!-- typed while the table was open -->');
    // The stale offsets would have landed inside the <dict> tag instead.
    expect(analyzeXml(next).stats.valid).toBe(true);
  });

  it('shows a <data> value as a byte count with an import, never as raw base64', () => {
    render('<plist version="1.0"><dict><key>b</key><data>Qmlmcm9zdA==</data></dict></plist>');
    const cell = container.querySelector('.plist-data');
    expect(cell?.textContent).toContain('7 bytes');
    expect(cell?.textContent).not.toContain('Qmlmcm9zdA==');
    expect(cell?.querySelector('.plist-linkbtn')?.textContent).toBe('Import…');
  });

  it('keeps a stepper on the value only, and disables it where stepping means nothing', () => {
    render();
    // One stepper per row now: Type became a popup, Value stayed a stepper
    // because stepping a boolean or a number is genuinely what you want.
    const stepper = (label: string) => rowWith(label).querySelectorAll('.plist-stepper');
    expect(stepper('Name')).toHaveLength(1);
    expect(stepper('Name')[0]?.classList).toContain('is-disabled');
    expect(stepper('Build')[0]?.classList).not.toContain('is-disabled');
    expect(stepper('Hidden')[0]?.classList).not.toContain('is-disabled');
  });
});

describe('table value helpers', () => {
  it('counts decoded bytes without decoding', () => {
    expect(base64Bytes('')).toBe(0);
    expect(base64Bytes('QQ==')).toBe(1);
    expect(base64Bytes('QUI=')).toBe(2);
    // "Bifrost" — seven bytes behind twelve base64 characters.
    expect(base64Bytes('Qmlmcm9zdA==')).toBe(7);
  });

  it('round-trips a date through the local-time picker', () => {
    const local = plistDateToLocalInput('2026-08-29T09:00:00Z');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(localInputToPlistDate(local)).toBe('2026-08-29T09:00:00Z');
    expect(plistDateToLocalInput('whenever')).toBe('');
    expect(localInputToPlistDate('nonsense')).toBeNull();
  });

  it('steps only the types that have a next value', () => {
    expect(stepValue('boolean', 'true', 1)).toBe('false');
    expect(stepValue('boolean', 'false', -1)).toBe('true');
    expect(stepValue('integer', '3', 1)).toBe('4');
    expect(stepValue('integer', 'nope', -1)).toBe('-1');
    expect(stepValue('real', '0.5', 1)).toBe('1.5');
    expect(stepValue('date', '2026-08-29T09:00:00Z', 1)).toBe('2026-08-30T09:00:00Z');
    expect(stepValue('string', 'anything', 1)).toBeNull();
    expect(stepValue('data', 'QQ==', 1)).toBeNull();
    expect(stepValue('dict', '', 1)).toBeNull();
  });
});

describe('the table only exists for a plist', () => {
  it('has no tree to render for ordinary XML', () => {
    // AtlasPage renders nothing when there is no tree; this pins the analysis
    // half of that contract, which is what decides it.
    const analysis = analyzeXml('<config><name>bifrost</name></config>');
    expect(analysis.isPlist).toBe(false);
    expect(analysis.plist).toBeNull();
    expect(vi.isMockFunction(analyzeXml)).toBe(false);
  });
});
