/**
 * The card-tone palette has a fixed number of slots (see --card-1..N in
 * tokens.css and .card-tone-N in app.css).
 *
 * Colour follows **position, per page**: pass each card its 1-based index within
 * its own grid (the first visible card is 1, the second 2, …). Every page starts
 * its own sequence from 1, and the slot wraps back to 1 after the last one — so a
 * page can hold any number of cards, reordering a card recolours it, and no card
 * ever hardcodes a colour.
 */
export const CARD_TONE_COUNT = 10;

/** Map a 1-based per-page card position to its `card-tone-N` class, cycling. */
export function cardToneClass(position: number): string {
  const slot = (((Math.trunc(position) - 1) % CARD_TONE_COUNT) + CARD_TONE_COUNT) % CARD_TONE_COUNT;
  return `card-tone-${slot + 1}`;
}
