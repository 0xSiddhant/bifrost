// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OfflineModeToggle } from './OfflineModeToggle';
import { OFF_STATUS, type WarmLoadStatus } from '../offlineMode';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('OfflineModeToggle', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (status: WarmLoadStatus, ready = true, onChange = () => {}) =>
    act(() => root.render(<OfflineModeToggle status={status} ready={ready} onChange={onChange} />));

  const input = () => container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const pill = () => container.querySelector('.offline-toggle__pill')?.textContent ?? '';

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts Off and unchecked', () => {
    render(OFF_STATUS);
    expect(input().checked).toBe(false);
    expect(pill()).toBe('Off');
  });

  it('shows Warming… while the imports are in flight', () => {
    render({ state: 'warming', loaded: 0, failed: [] });
    expect(input().checked).toBe(true);
    expect(pill()).toBe('Warming…');
  });

  it('shows Ready offline with the count once every target resolved', () => {
    render({ state: 'ready', loaded: 6, failed: [] });
    expect(pill()).toBe('Ready offline · 6');
  });

  it('says nothing is enabled rather than claiming a ready that warmed nothing', () => {
    render({ state: 'ready', loaded: 0, failed: [] });
    expect(pill()).toBe('Nothing enabled');
  });

  it('names the failures instead of a false Ready', () => {
    render({ state: 'partial', loaded: 5, failed: ['Loki (JS workbench)'] });
    expect(pill()).toContain('Partly ready');
    expect(pill()).toContain('Loki (JS workbench)');
  });

  it('is disabled until the policy config has arrived', () => {
    render(OFF_STATUS, false);
    expect(input().disabled).toBe(true);
  });

  it('reports both directions of the switch to its owner', () => {
    const onChange = vi.fn();
    render(OFF_STATUS, true, onChange);
    act(() => input().click());
    expect(onChange).toHaveBeenLastCalledWith(true);

    render({ state: 'ready', loaded: 6, failed: [] }, true, onChange);
    act(() => input().click());
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
