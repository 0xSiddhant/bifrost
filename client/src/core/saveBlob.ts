/**
 * Client-side downloads: every feature that hands the person a file it
 * already holds saves it through here. The one mechanism a browser has for
 * that is an object URL on a temporary `<a download>`, and nothing is sent
 * anywhere, so it works the same in the hub and the standalone build.
 *
 * Two entry points for the two things callers hold — bytes (a Brotli result,
 * decoded Base64) and text with a type (an editor's export, a patch, a
 * theme) — and one implementation under both.
 */

/** Saves bytes the page already holds, under `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  // In the document before the click: older Firefox ignores a click on a
  // detached anchor.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safe straight away: the click has already started the download.
  URL.revokeObjectURL(url);
}

/** Saves text as a file of the given media type, under `name`. */
export function saveText(text: string, name: string, mime: string): void {
  saveBlob(new Blob([text], { type: mime }), name);
}
