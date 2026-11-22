import { expect, type Page } from '@playwright/test';

/** An animation running on the page: its name, and the properties its keyframes move. */
export interface RunningAnimation {
  name: string;
  properties: string[];
}

/**
 * Every looping animation on the page: named CSS animations, and the Web
 * Animations the relics and a season's decorations start with an `id` (a
 * transition is a moment, not a loop, so it is left out).
 */
export async function runningAnimations(page: Page): Promise<RunningAnimation[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation ||
          (!(animation instanceof CSSTransition) && animation.id !== ''),
      )
      .map((animation) => ({
        name: animation instanceof CSSAnimation ? animation.animationName : animation.id,
        properties: [
          ...new Set(
            (animation.effect as KeyframeEffect)
              .getKeyframes()
              .flatMap((frame) =>
                Object.keys(frame).filter(
                  (key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
                ),
              ),
          ),
        ],
      })),
  );
}

/** PLAN-40: a long-running animation moves only what the compositor moves. */
export function expectCompositorOnly(animations: RunningAnimation[]): void {
  for (const { name, properties } of animations) {
    expect(properties.length, name).toBeGreaterThan(0);
    for (const property of properties) {
      expect(['transform', 'translate', 'opacity'], `${name} animates ${property}`).toContain(
        property,
      );
    }
  }
}

/** Waits until the sky's relics are drawn and every season slot has settled. */
export async function waitForSkyAndSlots(page: Page): Promise<void> {
  await expect(page.locator('.relic').first()).toBeAttached();
  await expect(page.locator('[data-decor-slot]')).toHaveCount(3);
  await expect(page.locator('[data-decor-slot][data-decor-state="loading"]')).toHaveCount(0);
}
