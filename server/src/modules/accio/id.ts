/**
 * Short handles for shelf rows. Unlike Runestone/Edda there is no slug: an
 * Accio link is never addressed by URL — the shelf is its only surface — so the
 * id only has to be short, opaque, and collision-checkable.
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ACCIO_ID_LENGTH = 6;

export function newAccioId(rng: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < ACCIO_ID_LENGTH; i += 1) {
    id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)] ?? '0';
  }
  return id;
}
