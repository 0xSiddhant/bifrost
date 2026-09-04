// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifications } from '../core/notify';
import { bifrostEvents } from '../core/sse';
import { usePublishedBanner } from './usePublishedBanner';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const MY_DEVICE = 'device-mine';

function Harness() {
  usePublishedBanner();
  return null;
}

/** Deliver a `file.published` frame as the SSE layer would. */
function publish(name: string, originDeviceId: string | null, folder?: string) {
  act(() => {
    listeners.forEach((listener) =>
      listener({ name, size: 10, publishedAt: Date.now(), originDeviceId, folder }),
    );
  });
}

let listeners: ((payload: unknown) => void)[] = [];

describe('usePublishedBanner', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    listeners = [];
    vi.spyOn(bifrostEvents, 'on').mockImplementation((event, listener) => {
      expect(event).toBe('file.published');
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    });
    // A stable id for this "device", so the self-filter has something to match.
    localStorage.setItem('bifrost.deviceId', MY_DEVICE);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => notifications.clear());
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const messages = () => notifications.getSnapshot().visible.map((entry) => entry.message);

  it('announces a file published by another device', () => {
    publish('report.pdf', 'device-other');
    expect(messages()).toEqual(['report.pdf is ready in Receive']);
  });

  // Criterion 4: including a second tab on the same device, which shares the id.
  it('stays quiet on the device that pressed Move', () => {
    publish('report.pdf', MY_DEVICE);
    expect(messages()).toEqual([]);
  });

  // Criterion 22: `null === null` must not read as "this is mine".
  it('announces a file whose origin device is unknown', () => {
    publish('mystery.pdf', null);
    expect(messages()).toEqual(['mystery.pdf is ready in Receive']);
  });

  // Criterion 5: twenty files must not paper the screen.
  it('collapses a bulk move into one counted banner', () => {
    for (let index = 1; index <= 20; index += 1) publish(`file-${index}.txt`, 'device-other');

    const { visible } = notifications.getSnapshot();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.message).toBe('20 files are ready in Receive');
    expect(visible[0]?.count).toBe(20);
  });

  it('starts counting again after the banner is dismissed', () => {
    publish('one.txt', 'device-other');
    publish('two.txt', 'device-other');
    expect(messages()).toEqual(['2 files are ready in Receive']);

    const banner = notifications.getSnapshot().visible[0];
    act(() => notifications.dismiss(banner?.id ?? -1));
    publish('three.txt', 'device-other');

    // Not "3 files" — the count nobody can see any more must not carry over.
    expect(messages()).toEqual(['three.txt is ready in Receive']);
  });

  // PLAN-24 criterion 15: the banner names the folder when there is one.
  it('names the folder a file landed in', () => {
    publish('a.jpg', 'device-other', 'Trip photos');
    expect(messages()).toEqual(['a.jpg is ready in Trip photos']);
  });

  it('still stays quiet on the uploading device in folder mode', () => {
    publish('a.jpg', MY_DEVICE, 'Trip photos');
    expect(messages()).toEqual([]);
  });

  /**
   * Criterion 16: ten files into one folder collapse to one banner, and a
   * concurrent plain Move keeps its own count rather than merging into it.
   */
  it('counts per destination, so a folder wave and a plain Move stay apart', () => {
    for (let index = 1; index <= 10; index += 1) {
      publish(`file-${index}.jpg`, 'device-other', 'Trip photos');
    }
    publish('loose.txt', 'device-other');

    const { visible } = notifications.getSnapshot();
    expect(visible).toHaveLength(2);
    expect(visible.map((entry) => entry.message).sort()).toEqual([
      '10 files are ready in Trip photos',
      'loose.txt is ready in Receive',
    ]);
  });

  it('keeps two different folders on two banners', () => {
    publish('a.jpg', 'device-other', 'Trip photos');
    publish('b.txt', 'device-other', 'Receipts');

    expect(messages().sort()).toEqual([
      'a.jpg is ready in Trip photos',
      'b.txt is ready in Receipts',
    ]);
  });

  it('ignores a frame the server could not serialise', () => {
    publish('', 'device-other');
    act(() => listeners.forEach((listener) => listener(null)));
    expect(messages()).toEqual([]);
  });
});
