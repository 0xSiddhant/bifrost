// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { useIdleActivity } from './useIdleActivity';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Renders the hook and exposes the latest value it returned. */
function harness() {
  const seen = { active: true };
  function Probe({ enabled }: { enabled: boolean }) {
    seen.active = useIdleActivity(enabled, 3000).active;
    return null;
  }
  return { seen, Probe };
}

describe('useIdleActivity (PLAN-28)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('starts active and goes idle after the timeout with no events', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: true })));
    expect(seen.active).toBe(true);

    advance(3001);
    expect(seen.active).toBe(false);
  });

  it('a mousemove wakes it and re-arms the timeout', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: true })));
    advance(3001);
    expect(seen.active).toBe(false);

    act(() => window.dispatchEvent(new MouseEvent('mousemove')));
    expect(seen.active).toBe(true);

    advance(2000);
    expect(seen.active).toBe(true);
    advance(1500);
    expect(seen.active).toBe(false);
  });

  it('a keypress wakes it', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: true })));
    advance(3001);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(seen.active).toBe(true);
  });

  it('a touch toggles rather than only waking — the only gesture a phone has', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: true })));
    advance(3001);
    expect(seen.active).toBe(false);

    // Hidden → shown.
    act(() => window.dispatchEvent(new Event('touchstart')));
    expect(seen.active).toBe(true);

    // Shown → hidden, without waiting out the timeout.
    act(() => window.dispatchEvent(new Event('touchstart')));
    expect(seen.active).toBe(false);
  });

  it('stays active forever while disabled — windowed mode never hides', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: false })));

    advance(60_000);
    expect(seen.active).toBe(true);

    act(() => window.dispatchEvent(new Event('touchstart')));
    expect(seen.active).toBe(true);
  });

  it('returns to active when fullscreen is left', () => {
    const { seen, Probe } = harness();
    act(() => root.render(createElement(Probe, { enabled: true })));
    advance(3001);
    expect(seen.active).toBe(false);

    act(() => root.render(createElement(Probe, { enabled: false })));
    expect(seen.active).toBe(true);
  });
});
