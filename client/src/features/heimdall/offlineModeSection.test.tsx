// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SECTIONS } from './sections';
import * as offlineMode from '../../core/offlineMode';
import { log } from '../../core/log';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const CONFIG: offlineMode.OfflineModeConfig = {
  targets: [
    { id: 'toolbox', label: 'Diagon Alley toolbox' },
    { id: 'loki', label: 'Loki (JS workbench)' },
  ],
  disabled: ['loki'],
};

/** Let the mount-time fetch and any click handler settle. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe('Heimdall offline-mode section (PLAN-22)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const section = SECTIONS.find((entry) => entry.id === 'offline-mode');
  const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

  const mount = async () => {
    const Component = section?.Component;
    if (!Component) throw new Error('offline-mode section is not registered');
    await act(async () => {
      root.render(<Component onLock={() => {}} />);
    });
    await flush();
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(offlineMode, 'fetchOfflineModeConfig').mockResolvedValue(CONFIG);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('is registered in the Realm group with a searchable control', () => {
    expect(section?.group).toBe('Realm');
    expect(section?.manifest.map((item) => item.controlId)).toContain('offline-targets');
  });

  it('renders one checkbox per registry target, checked unless disabled', async () => {
    await mount();
    expect(boxes()).toHaveLength(2);
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
    expect(container.textContent).toContain('Diagon Alley toolbox');
  });

  it('PATCHes the clicked target and adopts the server answer', async () => {
    const patch = vi
      .spyOn(offlineMode, 'setOfflineModeTargetEnabled')
      .mockResolvedValue({ ...CONFIG, disabled: ['toolbox', 'loki'] });
    await mount();

    await act(async () => {
      boxes()[0]?.click();
    });
    await flush();

    expect(patch).toHaveBeenCalledWith('toolbox', false);
    expect(boxes().map((box) => box.checked)).toEqual([false, false]);
  });

  it('surfaces a refused write instead of a checkbox that silently snaps back', async () => {
    vi.spyOn(offlineMode, 'setOfflineModeTargetEnabled').mockRejectedValue(new Error('nope'));
    const reported = vi.spyOn(log, 'reportError').mockImplementation(() => {});
    await mount();

    await act(async () => {
      boxes()[0]?.click();
    });
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not update');
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
    expect(reported).toHaveBeenCalledTimes(1);
  });
});
