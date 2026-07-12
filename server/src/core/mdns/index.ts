import os from 'node:os';
import { Bonjour } from 'bonjour-service';
import type { Logger } from '../logger/index.js';

export interface MdnsHandle {
  stop(): Promise<void>;
}

export function lanIPv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => (iface as os.NetworkInterfaceInfo).address);
}

/** Advertise the hub over Bonjour so Apple devices resolve http://<name>.local. */
export function advertiseMdns(name: string, port: number, log: Logger): MdnsHandle {
  const bonjour = new Bonjour();
  bonjour.publish({ name, type: 'http', port });
  log.info({ name: `${name}.local`, port }, 'mdns advertisement up');
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        bonjour.unpublishAll(() => {
          bonjour.destroy();
          resolve();
        });
      }),
  };
}
