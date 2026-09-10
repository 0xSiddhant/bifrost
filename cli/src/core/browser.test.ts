import { afterEach, describe, expect, it, vi } from 'vitest';

const launch = vi.hoisted(() => vi.fn());
vi.mock('open', () => ({ default: launch }));

const { openInBrowser, shouldLaunch } = await import('./browser.js');
const { CliError, setJsonMode } = await import('./output.js');
const { failure } = await import('../test/failure.js');

afterEach(() => {
  setJsonMode(false);
  launch.mockReset();
});

describe('shouldLaunch', () => {
  it('launches by default — that is the whole point of `preview`', () => {
    expect(shouldLaunch(false)).toBe(true);
  });

  it('does not launch when --no-open was passed', () => {
    expect(shouldLaunch(true)).toBe(false);
  });

  it('never launches under --json, whatever --no-open itself says', () => {
    setJsonMode(true);
    expect(shouldLaunch(false)).toBe(false);
    expect(shouldLaunch(true)).toBe(false);
  });
});

describe('openInBrowser', () => {
  it('hands the URL to the platform launcher', async () => {
    launch.mockResolvedValue(undefined);
    await openInBrowser('http://bifrost.local:4646/edda/preview/trip-a1b2c3');
    expect(launch).toHaveBeenCalledWith('http://bifrost.local:4646/edda/preview/trip-a1b2c3');
  });

  it('turns a headless failure into advice, not a stack trace', async () => {
    launch.mockRejectedValue(new Error('spawn xdg-open ENOENT'));
    const error = await failure(openInBrowser('http://x/y'));

    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('spawn xdg-open ENOENT');
    expect(error.message).toContain('--no-open');
  });
});
