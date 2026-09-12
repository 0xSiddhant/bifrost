// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCodeCopyButtons, handleCodeCopyClick, COPIED_FEEDBACK_MS } from './codeCopy';
import { renderMarkdown } from './render';

const writeText = vi.fn<(text: string) => Promise<void>>();

/** Click through the real delegated path, as the hook wires it up. */
async function clickCopy(container: HTMLElement, index = 0): Promise<void> {
  const buttons = container.querySelectorAll<HTMLButtonElement>('.md-copy');
  const button = buttons[index];
  if (!button) throw new Error(`no copy button at index ${index}`);
  const event = new MouseEvent('click', { bubbles: true });
  button.dispatchEvent(event);
  await handleCodeCopyClick(event);
}

describe('attachCodeCopyButtons', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  it('injects one button per fenced block', () => {
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```\n\ntext\n\n```js\nlet a = 1;\n```');
    attachCodeCopyButtons(container);

    expect(container.querySelectorAll('.md-copy')).toHaveLength(2);
    expect(container.querySelectorAll('.md-codeblock')).toHaveLength(2);
  });

  it('does not add a second button when it runs again over the same container', () => {
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```');
    attachCodeCopyButtons(container);
    attachCodeCopyButtons(container);
    attachCodeCopyButtons(container);

    expect(container.querySelectorAll('.md-copy')).toHaveLength(1);
    expect(container.querySelectorAll('.md-codeblock')).toHaveLength(1);
  });

  it('leaves a mermaid placeholder alone', () => {
    // The mermaid pass replaces that <pre> node itself, so wrapping it would
    // strand an empty wrapper and a copy button on a rendered diagram.
    container.innerHTML = renderMarkdown('```mermaid\ngraph TD\n  A-->B\n```');

    expect(container.querySelector('pre.mermaid-src')).not.toBeNull();
    attachCodeCopyButtons(container);

    expect(container.querySelector('.md-copy')).toBeNull();
    expect(container.querySelector('pre.mermaid-src')?.parentElement).toBe(container);
  });

  it('copies the raw source, not the highlighted markup', async () => {
    const source = 'const answer = 42;\nif (answer > 0) return "yes";';
    container.innerHTML = renderMarkdown(`\`\`\`js\n${source}\n\`\`\``);
    attachCodeCopyButtons(container);

    // Guard the premise: highlight.js really did wrap this in markup.
    expect(container.querySelector('code')?.innerHTML).toContain('<span');

    await clickCopy(container);

    expect(writeText).toHaveBeenCalledWith(source);
  });

  it('copies the clicked block, not the first one', async () => {
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```\n\n```yaml\nb: 2\n```');
    attachCodeCopyButtons(container);

    await clickCopy(container, 1);

    expect(writeText).toHaveBeenCalledWith('b: 2');
  });

  it('swaps the icon to a checkmark and back after the feedback window', async () => {
    vi.useFakeTimers();
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```');
    attachCodeCopyButtons(container);
    const button = container.querySelector<HTMLButtonElement>('.md-copy');
    if (!button) throw new Error('no copy button');

    const clipboardMarkup = button.innerHTML;
    await clickCopy(container);

    expect(button.innerHTML).not.toBe(clipboardMarkup);
    expect(button.getAttribute('aria-label')).toBe('Copied');

    vi.advanceTimersByTime(COPIED_FEEDBACK_MS);

    expect(button.innerHTML).toBe(clipboardMarkup);
    expect(button.getAttribute('aria-label')).toBe('Copy code');
  });

  it('ignores a click that is not on a copy button', async () => {
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```\n\nprose');
    attachCodeCopyButtons(container);

    const event = new MouseEvent('click', { bubbles: true });
    container.querySelector('p')?.dispatchEvent(event);
    await handleCodeCopyClick(event);

    expect(writeText).not.toHaveBeenCalled();
  });

  it('leaves the checkmark off when the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    // core/copy falls back to execCommand, which jsdom does not implement.
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    container.innerHTML = renderMarkdown('```json\n{"a":1}\n```');
    attachCodeCopyButtons(container);
    const button = container.querySelector<HTMLButtonElement>('.md-copy');
    const before = button?.innerHTML;

    await clickCopy(container);

    expect(button?.innerHTML).toBe(before);
    expect(button?.getAttribute('aria-label')).toBe('Copy code');
  });
});
