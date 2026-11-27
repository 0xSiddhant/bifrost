// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PresenceDevice } from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const wire = vi.hoisted(() => ({
  renameDevice: vi.fn(),
  presence: { devices: [] as PresenceDevice[], ready: true },
}));
vi.mock('./api', () => ({ renameDevice: wire.renameDevice }));
vi.mock('./usePresence', () => ({ usePresence: () => wire.presence }));
vi.mock('../../core/deviceId', () => ({ getDeviceId: () => 'me' }));

import { WardensPage } from './WardensPage';

const me = (name: string | null): PresenceDevice => ({
  deviceId: 'me',
  name,
  charName: 'Heimdall',
  label: 'Mac',
  online: true,
  lastSeen: 0,
});

describe('WardensPage rename', () => {
  let container: HTMLDivElement;
  let root: Root;

  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Device name"]');
  const type = async (value: string) => {
    await act(async () => {
      const box = input();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
      box?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const save = async () => {
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
    });
  };
  /** A live `presence.changed` arrives with this device's name. */
  const hear = async (name: string | null) => {
    wire.presence = { devices: [me(name)], ready: true };
    await act(async () => {
      root.render(<WardensPage />);
    });
  };

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    wire.renameDevice.mockReset().mockResolvedValue({ devices: [] });
    wire.presence = { devices: [me(null)], ready: true };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<WardensPage />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps what was typed when the echo of an earlier save lands late', async () => {
    await type('Hall');
    await save();
    expect(wire.renameDevice).toHaveBeenLastCalledWith('me', 'Hall');
    // The person clears the name before this device hears its own rename back.
    await type('');
    await hear('Hall');
    expect(input()?.value).toBe('');
    await save();
    expect(wire.renameDevice).toHaveBeenLastCalledWith('me', null);
  });

  it('shows a name the server sends while nothing is being typed', async () => {
    await hear('Named elsewhere');
    expect(input()?.value).toBe('Named elsewhere');
    await type('Hall');
    await save();
    await hear('Hall');
    await hear('Renamed again elsewhere');
    expect(input()?.value).toBe('Renamed again elsewhere');
  });
});
