import { describe, expect, it } from 'vitest';
import { columnCount, panelInsertIndex, scrollPlan, SCROLL_GAP } from './expandingGridMath';

describe('columnCount', () => {
  it('counts the used track list a browser actually returns', () => {
    expect(columnCount('246px 246px 246px')).toBe(3);
    expect(columnCount('  246px   246px  ')).toBe(2);
    expect(columnCount('1fr')).toBe(1);
  });

  it('ignores line names — a named track is still one track', () => {
    expect(columnCount('[full-start] 246px [mid] 246px [full-end]')).toBe(2);
  });

  it('falls back to one column rather than throwing on nothing useful', () => {
    expect(columnCount('none')).toBe(1);
    expect(columnCount('')).toBe(1);
    expect(columnCount('   ')).toBe(1);
    expect(columnCount(null)).toBe(1);
    expect(columnCount(undefined)).toBe(1);
  });
});

describe('panelInsertIndex', () => {
  it('puts the panel at the end of the open card row', () => {
    // 8 cards, 3 columns: rows are [0 1 2] [3 4 5] [6 7]
    expect(panelInsertIndex(0, 3, 8)).toBe(3);
    expect(panelInsertIndex(1, 3, 8)).toBe(3);
    expect(panelInsertIndex(2, 3, 8)).toBe(3);
    expect(panelInsertIndex(3, 3, 8)).toBe(6);
    expect(panelInsertIndex(5, 3, 8)).toBe(6);
  });

  it('clamps to the end of the list for a short final row', () => {
    expect(panelInsertIndex(6, 3, 8)).toBe(8);
    expect(panelInsertIndex(7, 3, 8)).toBe(8);
  });

  it('degenerates to "directly below the card" at one column', () => {
    expect(panelInsertIndex(0, 1, 4)).toBe(1);
    expect(panelInsertIndex(2, 1, 4)).toBe(3);
    expect(panelInsertIndex(3, 1, 4)).toBe(4);
  });

  it('handles the wide grids the toolbox actually renders at', () => {
    expect(panelInsertIndex(0, 2, 15)).toBe(2);
    expect(panelInsertIndex(4, 4, 15)).toBe(8);
    expect(panelInsertIndex(13, 5, 15)).toBe(15);
    expect(panelInsertIndex(9, 5, 15)).toBe(10);
  });

  it('survives a nonsense column count instead of producing NaN', () => {
    expect(panelInsertIndex(2, 0, 6)).toBe(3);
    expect(panelInsertIndex(2, -4, 6)).toBe(3);
    expect(panelInsertIndex(-1, 3, 6)).toBe(6);
  });
});

describe('scrollPlan', () => {
  const base = {
    cardTop: 400,
    panelTop: 600,
    panelHeight: 300,
    viewportH: 800,
    headerH: 62,
    bottomNavH: 0,
    scrollY: 0,
  };

  it('branch 1: does not scroll a panel that is already fully visible', () => {
    expect(scrollPlan({ ...base, panelTop: 200, panelHeight: 300 })).toBeNull();
  });

  it('branch 1 respects the header inset — a panel under the header is not "visible"', () => {
    // Panel top at 500 with the page scrolled to 460: only 40px clear of the
    // top, less than the 62px header + gap.
    expect(scrollPlan({ ...base, panelTop: 500, panelHeight: 100, scrollY: 460 })).not.toBeNull();
  });

  it('branch 2: scrolls the minimum that clears the bottom inset', () => {
    // Panel 600..900, viewport 0..800 → needs 100px + the gap.
    expect(scrollPlan(base)).toBe(900 - 800 + SCROLL_GAP);
  });

  it('branch 2 accounts for the mobile bottom nav', () => {
    const withNav = scrollPlan({ ...base, bottomNavH: 61 });
    expect(withNav).toBe(900 - 800 + 61 + SCROLL_GAP);
    expect(withNav).toBeGreaterThan(scrollPlan(base) as number);
  });

  it('branch 2: scrolls back up the minimum for a panel above the fold', () => {
    expect(scrollPlan({ ...base, panelTop: 300, panelHeight: 200, scrollY: 500 })).toBe(
      300 - 62 - SCROLL_GAP,
    );
  });

  it('branch 3: a panel taller than the viewport aligns the card under the header', () => {
    expect(scrollPlan({ ...base, panelHeight: 2000 })).toBe(400 - 62 - SCROLL_GAP);
  });

  it('branch 3 keeps the panel top on screen rather than its bottom', () => {
    const target = scrollPlan({ ...base, cardTop: 400, panelTop: 600, panelHeight: 2000 });
    // Panel top (600) must land inside the viewport that starts at `target`.
    expect(600 - (target as number)).toBeLessThan(base.viewportH);
    expect(600 - (target as number)).toBeGreaterThan(0);
  });

  it('never scrolls to a negative offset', () => {
    // A card near the very top would want a negative target; clamp to 0. Start
    // scrolled down so "already there" cannot mask the clamp.
    expect(scrollPlan({ ...base, cardTop: 10, panelTop: 40, panelHeight: 2000, scrollY: 300 })).toBe(
      0,
    );
  });

  it('returns null instead of animating to where we already are', () => {
    const target = scrollPlan({ ...base, panelHeight: 2000 }) as number;
    expect(scrollPlan({ ...base, panelHeight: 2000, scrollY: target })).toBeNull();
  });
});
