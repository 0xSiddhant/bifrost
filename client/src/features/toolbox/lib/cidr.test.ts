import { describe, expect, it } from 'vitest';
import { contains, formatIpv4, parseCidr, parseIpv4 } from './cidr';

describe('parseIpv4', () => {
  it('round-trips through the unsigned 32-bit form', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '192.168.1.33', '255.255.255.255', '128.0.0.0']) {
      expect(formatIpv4(parseIpv4(ip) as number)).toBe(ip);
    }
  });

  it('keeps high addresses unsigned — the >>> 0 that is easy to forget', () => {
    // 224.0.0.1 has the top bit set; a signed shift would give a negative.
    expect(parseIpv4('224.0.0.1')).toBeGreaterThan(0);
    expect(parseIpv4('255.255.255.255')).toBe(4294967295);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['1.2.3', '1.2.3.4.5', '256.1.1.1', 'a.b.c.d', '1.2.3.-1', '']) {
      expect(parseIpv4(bad)).toBeNull();
    }
  });

  it('rejects a leading zero rather than guessing octal or decimal', () => {
    expect(parseIpv4('010.1.1.1')).toBeNull();
    expect(parseIpv4('0.1.1.1')).not.toBeNull();
  });
});

describe('parseCidr', () => {
  it('describes a /24 the way a router does', () => {
    const info = parseCidr('192.168.1.0/24');
    expect(info).toMatchObject({
      cidr: '192.168.1.0/24',
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      mask: '255.255.255.0',
      wildcard: '0.0.0.255',
      firstHost: '192.168.1.1',
      lastHost: '192.168.1.254',
      totalAddresses: 256,
      usableHosts: 254,
      scope: 'private',
    });
  });

  it('normalises host bits to the block they belong to', () => {
    const info = parseCidr('192.168.1.130/24');
    expect(info?.network).toBe('192.168.1.0');
    expect(info?.cidr).toBe('192.168.1.0/24');
    // The typed address is kept for display — the user should see both.
    expect(info?.address).toBe('192.168.1.130');
  });

  it('handles /31 as a point-to-point link with two usable addresses', () => {
    const info = parseCidr('10.0.0.4/31');
    expect(info?.totalAddresses).toBe(2);
    expect(info?.usableHosts).toBe(2);
    expect(info?.firstHost).toBe('10.0.0.4');
    expect(info?.lastHost).toBe('10.0.0.5');
    expect(info?.note).toMatch(/RFC 3021/);
  });

  it('handles /32 as a single host', () => {
    const info = parseCidr('10.0.0.7/32');
    expect(info?.totalAddresses).toBe(1);
    expect(info?.usableHosts).toBe(1);
    expect(info?.network).toBe('10.0.0.7');
    expect(info?.broadcast).toBe('10.0.0.7');
    expect(info?.firstHost).toBe('10.0.0.7');
  });

  it('handles /0 — the shift that would otherwise wrap to a full mask', () => {
    const info = parseCidr('1.2.3.4/0');
    expect(info?.mask).toBe('0.0.0.0');
    expect(info?.network).toBe('0.0.0.0');
    expect(info?.broadcast).toBe('255.255.255.255');
    expect(info?.totalAddresses).toBe(4294967296);
  });

  it('reads a bare address as /32', () => {
    expect(parseCidr('8.8.8.8')?.bits).toBe(32);
  });

  it('classifies the scopes a home network actually contains', () => {
    expect(parseCidr('10.1.2.0/24')?.scope).toBe('private');
    expect(parseCidr('172.16.0.0/12')?.scope).toBe('private');
    expect(parseCidr('172.32.0.0/16')?.scope).toBe('public');
    expect(parseCidr('192.168.0.0/16')?.scope).toBe('private');
    expect(parseCidr('127.0.0.1/8')?.scope).toBe('loopback');
    expect(parseCidr('169.254.1.1/16')?.scope).toBe('link-local');
    expect(parseCidr('224.0.0.1/24')?.scope).toBe('multicast');
    expect(parseCidr('8.8.8.8/32')?.scope).toBe('public');
  });

  it('rejects nonsense instead of rendering NaN', () => {
    for (const bad of ['', 'nope', '192.168.1.0/33', '192.168.1.0/abc', '999.1.1.1/24']) {
      expect(parseCidr(bad)).toBeNull();
    }
  });
});

describe('contains', () => {
  it('answers the membership question at both edges', () => {
    const info = parseCidr('192.168.1.0/24');
    if (!info) throw new Error('expected a block');
    expect(contains(info, '192.168.1.0')).toBe(true);
    expect(contains(info, '192.168.1.255')).toBe(true);
    expect(contains(info, '192.168.2.0')).toBe(false);
    expect(contains(info, '192.168.0.255')).toBe(false);
    expect(contains(info, 'not-an-ip')).toBeNull();
  });
});
