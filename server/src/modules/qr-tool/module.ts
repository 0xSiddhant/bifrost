import QRCode from 'qrcode';
import type { AppConfig } from '../../core/config/index.js';
import { lanIPv4Addresses } from '../../core/mdns/index.js';
import type { FeatureModule } from '../../core/module.js';

/**
 * Every way onto this server, LAN IPs first — Android can't resolve .local,
 * so the IP url is the one the QR page and boot log lead with.
 */
export function serverUrls(config: AppConfig): string[] {
  const urls = lanIPv4Addresses().map((address) => `http://${address}:${config.port}`);
  if (config.profile === 'local') {
    urls.push(`http://${config.mdnsName}.local:${config.port}`);
  }
  return urls;
}

/** ASCII QR for the boot log (the "join from your phone" fallback). */
export function terminalQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'terminal', small: true });
}

/**
 * QR generation itself is client-side (nothing to log, works offline) — the
 * server's only job is telling clients which URLs reach it.
 */
export const qrToolModule: FeatureModule = {
  name: 'qr-tool',
  register(app, deps) {
    app.get('/api/qr/server-url', () => ({ urls: serverUrls(deps.config) }));
  },
};
