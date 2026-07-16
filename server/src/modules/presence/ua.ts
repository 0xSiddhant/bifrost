import { UAParser } from 'ua-parser-js';

/**
 * A short, human label for a device from its User-Agent — e.g.
 * "iPhone · Safari", "macOS · Chrome". Falls back gracefully on odd/empty UAs.
 */
export function uaLabel(ua: string): string {
  if (!ua || !ua.trim()) return 'Unknown device';
  const result = new UAParser(ua).getResult();
  // Phones/tablets → their model ("iPhone", "Pixel 7"); desktops → the OS name
  // ("macOS", "Windows"), since the model there is a generic "Macintosh".
  const isHandheld = result.device.type === 'mobile' || result.device.type === 'tablet';
  const device =
    (isHandheld ? result.device.model : result.os.name) ??
    result.os.name ??
    result.device.model ??
    'Device';
  const browser = (result.browser.name ?? 'Browser').replace(/^Mobile /, '');
  return `${device} · ${browser}`;
}
