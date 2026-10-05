import { describe, expect, it } from 'vitest';
import { LiveListSync } from './liveList';

const add = (item: string) => (list: string[]) => (list.includes(item) ? list : [item, ...list]);
const remove = (item: string) => (list: string[]) => list.filter((entry) => entry !== item);

describe('LiveListSync', () => {
  it('replays a change that arrived while the fetch was in flight', () => {
    const sync = new LiveListSync<string>();
    const fetch = sync.begin();
    sync.record(add('published-mid-fetch'));
    // The answer was computed before the change, so it lacks it.
    expect(sync.settle(fetch, ['older'])).toEqual(['published-mid-fetch', 'older']);
  });

  it('replays removals too, so a row deleted mid-fetch does not come back', () => {
    const sync = new LiveListSync<string>();
    const fetch = sync.begin();
    sync.record(remove('deleted'));
    expect(sync.settle(fetch, ['deleted', 'kept'])).toEqual(['kept']);
  });

  it('does not replay a change made before the fetch started', () => {
    const sync = new LiveListSync<string>();
    sync.record(add('before'));
    const fetch = sync.begin();
    expect(sync.settle(fetch, ['x'])).toEqual(['x']);
  });

  it('drops an older answer that lands after a newer one', () => {
    const sync = new LiveListSync<string>();
    const older = sync.begin();
    const newer = sync.begin();
    expect(sync.settle(newer, ['new'])).toEqual(['new']);
    expect(sync.settle(older, ['old'])).toBeNull();
  });

  it('applies answers that land in order', () => {
    const sync = new LiveListSync<string>();
    const first = sync.begin();
    const second = sync.begin();
    sync.record(add('live'));
    expect(sync.settle(first, ['a'])).toEqual(['live', 'a']);
    expect(sync.settle(second, ['a', 'live'])).toEqual(['a', 'live']);
  });

  it('stops recording for an abandoned fetch', () => {
    const sync = new LiveListSync<string>();
    const failed = sync.begin();
    sync.abandon(failed);
    sync.record(add('x'));
    expect(sync.settle(failed, ['y'])).toEqual(['y']);
  });
});
