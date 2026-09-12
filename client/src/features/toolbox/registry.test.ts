import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOLS, availableTools, isSupported, resetSupportCache, type ToolCard } from './registry';

const stub = (over: Partial<ToolCard> = {}): ToolCard => ({
  id: 'stub',
  title: 'Stub',
  hint: 'a stub',
  icon: null,
  module: 'toolbox',
  ...over,
});

beforeEach(() => resetSupportCache());

describe('TOOLS', () => {
  it('has unique ids — the id is the URL segment', () => {
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
  });

  it('gives every expanding tool an inner layout and every route card a target', () => {
    for (const tool of TOOLS) {
      if (tool.to) expect(tool.to.startsWith('/')).toBe(true);
      else expect(tool.layout).toBeDefined();
    }
  });

  it('gates the pure-client tools on the toolbox module and the pages on their own', () => {
    const byId = new Map(TOOLS.map((tool) => [tool.id, tool]));
    expect(byId.get('qr')?.module).toBe('toolbox');
    expect(byId.get('base64')?.module).toBe('toolbox');
    expect(byId.get('nimbus')?.module).toBe('nimbus');
    expect(byId.get('portkey')?.module).toBe('portkey');
  });

  it('holds every tool both parts of PLAN-18 specified, in the plan order', () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([
      'nimbus', 'portkey',
      'qr', 'base64', 'uuid', 'epoch',
      'url', 'bytes', 'jwt', 'iris', 'cidr', 'case', 'secret', 'cron', 'hash',
    ]);
  });

  it('gates SHA-256 on crypto.subtle, and nothing else', () => {
    const gated = TOOLS.filter((tool) => tool.supported);
    expect(gated.map((tool) => tool.id)).toEqual(['hash']);
    // UUID and the password generator deliberately do NOT need the hook:
    // getRandomValues is available on a plain-http origin.
    expect(TOOLS.find((tool) => tool.id === 'uuid')?.supported).toBeUndefined();
    expect(TOOLS.find((tool) => tool.id === 'secret')?.supported).toBeUndefined();
  });

  it('hides SHA-256 exactly when crypto.subtle is missing', () => {
    const hash = TOOLS.find((tool) => tool.id === 'hash');
    if (!hash?.supported) throw new Error('expected a gated hash tool');
    // `subtle` is a prototype getter, not an own property — so restoring means
    // deleting the shadow we define, not re-defining a descriptor that was
    // never there.
    const own = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');

    expect(hash.supported()).toBe(true); // Node is a secure context
    Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined });
    try {
      resetSupportCache();
      expect(hash.supported()).toBe(false);
      expect(availableTools(TOOLS, () => true).some((tool) => tool.id === 'hash')).toBe(false);
    } finally {
      if (own) Object.defineProperty(globalThis.crypto, 'subtle', own);
      else Reflect.deleteProperty(globalThis.crypto, 'subtle');
      resetSupportCache();
    }
    expect(availableTools(TOOLS, () => true).some((tool) => tool.id === 'hash')).toBe(true);
  });
});

describe('availableTools', () => {
  it('drops every tool card when the toolbox module is absent, keeping the pages', () => {
    const visible = availableTools(TOOLS, (module) => module !== 'toolbox');
    expect(visible.map((tool) => tool.id)).toEqual(['nimbus', 'portkey']);
  });

  it('drops one page without touching the others', () => {
    const visible = availableTools(TOOLS, (module) => module !== 'portkey');
    expect(visible.some((tool) => tool.id === 'portkey')).toBe(false);
    expect(visible.some((tool) => tool.id === 'nimbus')).toBe(true);
    expect(visible.some((tool) => tool.id === 'base64')).toBe(true);
  });

  it('hides a tool whose environment gate says no', () => {
    const tools = [stub({ id: 'a' }), stub({ id: 'hash', supported: () => false })];
    expect(availableTools(tools, () => true).map((tool) => tool.id)).toEqual(['a']);
  });

  it('keeps a tool whose gate says yes, and one with no gate at all', () => {
    const tools = [stub({ id: 'a' }), stub({ id: 'b', supported: () => true })];
    expect(availableTools(tools, () => true)).toHaveLength(2);
  });
});

describe('isSupported', () => {
  it('asks once and remembers — the answer cannot change mid-session', () => {
    const probe = vi.fn(() => true);
    const tool = stub({ id: 'probe', supported: probe });

    expect(isSupported(tool)).toBe(true);
    expect(isSupported(tool)).toBe(true);
    expect(isSupported(tool)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('treats a probe that throws as "not supported" rather than crashing the hub', () => {
    const tool = stub({
      id: 'thrower',
      supported: () => {
        throw new Error('crypto.subtle is undefined');
      },
    });
    expect(isSupported(tool)).toBe(false);
  });

  it('is the gate a plain-http device hits for SHA-256', () => {
    // The Part B shape, pinned here so the mechanism is proven before the tool
    // that needs it lands: crypto.subtle is secure-context-only, so on a LAN
    // http origin the card must not render at all.
    const secureContextOnly = stub({ id: 'hash', supported: () => false });
    expect(availableTools([secureContextOnly], () => true)).toEqual([]);
  });
});
