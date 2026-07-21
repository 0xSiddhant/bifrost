/**
 * Cross-pane search reveal (owner spec): when the in-editor find lands on a
 * match in one Variant pane, the other pane scrolls to the same string if it is
 * present there. Pure offset finder — case-insensitive so "found" stays lenient
 * (the match text already came from a real hit on the source side).
 */
export function crossPaneOffset(otherText: string, matchText: string): number | null {
  if (matchText === '') return null;
  const index = otherText.toLowerCase().indexOf(matchText.toLowerCase());
  return index < 0 ? null : index;
}
