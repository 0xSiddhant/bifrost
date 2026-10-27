/**
 * Hands the browser a file to save — the one mechanism a client-side download
 * has: an object URL on a temporary `<a download>`. Nothing is sent anywhere,
 * so it works the same in the hub and the standalone build.
 *
 * The anchor goes into the document before the click because older Firefox
 * ignores a click on a detached one. Revoking straight after is safe: the
 * click has already started the download from the URL.
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
