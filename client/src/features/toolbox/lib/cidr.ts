/**
 * IPv4 CIDR maths (PLAN-18). All arithmetic goes through unsigned 32-bit
 * integers via `>>> 0`, because JS bit operators produce *signed* results and
 * every address from 128.0.0.0 up would otherwise come back negative.
 */

export interface CidrInfo {
  /** Canonical `network/bits`, whatever host bits the input carried. */
  cidr: string;
  address: string;
  bits: number;
  network: string;
  broadcast: string;
  mask: string;
  wildcard: string;
  firstHost: string;
  lastHost: string;
  totalAddresses: number;
  usableHosts: number;
  /** RFC 1918 / loopback / link-local — "is this safe to hand out at home?" */
  scope: 'private' | 'loopback' | 'link-local' | 'multicast' | 'public';
  /** Set for the two block sizes whose host rules are special. */
  note: string | null;
}

export function parseIpv4(input: string): number | null {
  const parts = input.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    // Reject 01.2.3.4: a leading zero means octal to some parsers and decimal
    // to others, so the safe answer is to refuse rather than pick one.
    if (part.length > 1 && part.startsWith('0')) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value >>> 0;
}

export function formatIpv4(value: number): string {
  const v = value >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

function scopeOf(network: number): CidrInfo['scope'] {
  const first = (network >>> 24) & 255;
  const second = (network >>> 16) & 255;
  if (first === 127) return 'loopback';
  if (first === 10) return 'private';
  if (first === 172 && second >= 16 && second <= 31) return 'private';
  if (first === 192 && second === 168) return 'private';
  if (first === 169 && second === 254) return 'link-local';
  if (first >= 224 && first <= 239) return 'multicast';
  return 'public';
}

/**
 * `192.168.1.10/24` → the block it belongs to. A bare address is read as /32,
 * and host bits in the input are kept for display but do not move the block.
 */
export function parseCidr(input: string): CidrInfo | null {
  const text = input.trim();
  if (!text) return null;
  const [addressPart, bitsPart = '32'] = text.split('/');
  if (addressPart === undefined) return null;
  const address = parseIpv4(addressPart);
  if (address === null) return null;
  if (!/^\d{1,2}$/.test(bitsPart)) return null;
  const bits = Number(bitsPart);
  if (bits > 32) return null;

  // `<<` is mod-32 in JS, so a /0 mask would come out as 0xffffffff.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - bits);

  let firstHost = network;
  let lastHost = broadcast;
  let usableHosts = total - 2;
  let note: string | null = null;
  if (bits === 32) {
    usableHosts = 1;
    note = 'A single address — the whole block is one host.';
  } else if (bits === 31) {
    // RFC 3021: a /31 is a point-to-point link, both addresses usable.
    usableHosts = 2;
    note = 'A point-to-point link (RFC 3021) — both addresses are usable, with no network or broadcast address.';
  } else {
    firstHost = (network + 1) >>> 0;
    lastHost = (broadcast - 1) >>> 0;
  }

  return {
    cidr: `${formatIpv4(network)}/${bits}`,
    address: formatIpv4(address),
    bits,
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    mask: formatIpv4(mask),
    wildcard: formatIpv4(~mask >>> 0),
    firstHost: formatIpv4(firstHost),
    lastHost: formatIpv4(lastHost),
    totalAddresses: total,
    usableHosts,
    scope: scopeOf(network),
    note,
  };
}

/** Does this address fall inside that block? The other question people ask. */
export function contains(info: CidrInfo, address: string): boolean | null {
  const value = parseIpv4(address);
  if (value === null) return null;
  const network = parseIpv4(info.network);
  const broadcast = parseIpv4(info.broadcast);
  if (network === null || broadcast === null) return null;
  return value >= network && value <= broadcast;
}
