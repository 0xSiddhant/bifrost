import os from 'node:os';

/**
 * This machine's LAN IPv4 addresses: the join URLs, the boot QR and the boot
 * log name the hub by these. It used to live beside the mDNS responder, which
 * moved to the web host in PLAN-36 (the process answering PORT must also answer
 * for `bifrost.local`); the web host keeps its own copy, since workspaces do
 * not import each other.
 */
export function lanIPv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => (iface as os.NetworkInterfaceInfo).address);
}
