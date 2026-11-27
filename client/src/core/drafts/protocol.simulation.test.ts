import { describe, expect, it } from 'vitest';
import { memoryBackend } from './coordinator';
import { legacyTextParse, textDraftCodec, type TextDraft } from './documents';
import {
  CLAIM_LEASE_MS,
  OFFER_GRACE_MS,
  PRUNE_GRACE_MS,
  LEGACY_KEYS,
  type AcceptResult,
  acceptLegacy,
  acceptOffer,
  dismissLegacy,
  dismissOffer,
  findLegacy,
  findOffer,
  registerLifetime,
  sweep,
  writeDeparture,
  type Me,
  type ProtocolContext,
} from './protocol';
import { RECORD_PREFIX, SCRATCH, makeEnvelope, parseRecordKey, recordKey } from './records';
import { memoryStorage, type DraftStorage } from './storage';

/**
 * The cross-tab draft protocol under random schedules (PLAN-43, after the
 * code review of #122). Every bug that review found was an interleaving the
 * hand-written tests had not thought of: a sweep deciding per editor, a
 * claimant stalled past its lease, a restore over this tab's own work. So
 * instead of one more scenario, this runs many seeded random ones (tabs write,
 * clear, close, come back, restore, race, stall, dismiss and sweep; storage
 * and commits fail) and checks, after every step, what must always hold:
 *
 * 1. No draft is lost: a draft's text disappears only when its own tab clears
 *    or overwrites it, or when a sweep prunes it while a newer draft remains in
 *    the same workspace (newest wins, owner 2026-11-26).
 * 2. A restore is never visible twice: after it, the restored text is in
 *    exactly one record no tombstone hides.
 * 3. A restore never changes the claimant's own record for the workspace.
 * 4. No step changes a record of a tab that is open, other than that tab's
 *    own steps.
 * 5. A restore attempt, whatever its outcome, never destroys the draft it was
 *    offered: it ends up here, or stays where it was. The same holds for the
 *    draft an older build left in its single slot, until a newer value
 *    replaces it there.
 * 6. Work the claimant does while its restore runs (its mirror writes, or the
 *    buffer on screen changes before the mirror has) is never replaced: the
 *    restore stands down, and its record keeps what was written. That holds
 *    even when the completing commit fails after its callback ran.
 *
 * A failure names the seed and the steps so far: replay with `SEEDS=<seed>`.
 */

const FEATURE = 'runestone' as const;
const TABS = ['tab-a', 'tab-b', 'tab-c'] as const;
const WORKSPACES = [SCRATCH, 'doc:1'] as const;
const STEPS = 60;
const SEED_COUNT = 400;
const features = { [FEATURE]: { codec: textDraftCodec as (raw: unknown) => unknown } };
const worth = (draft: TextDraft) => draft.text.trim() !== '';
const LEGACY = legacyTextParse((text) => text.trim() === '');
const LEGACY_KEY = LEGACY_KEYS[FEATURE] ?? '';

/** mulberry32: a small seeded generator, so every run can be replayed. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p: number) => next() < p,
  };
}

/** localStorage stand-in that can refuse writes to one key (a full quota for that copy). */
function faultyStorage(): DraftStorage & { failKey: string | null } {
  const inner = memoryStorage();
  const area = {
    failKey: null as string | null,
    get: (key: string) => inner.get(key),
    set: (key: string, value: string) => {
      if (area.failKey === key) throw new DOMException('full', 'QuotaExceededError');
      inner.set(key, value);
    },
    remove: (key: string) => inner.remove(key),
    keys: () => inner.keys(),
  };
  return area;
}

/** A broken invariant: never swallowed as an injected fault. */
class InvariantBroken extends Error {}

interface Tab {
  tab: string;
  instance: string;
  open: boolean;
}

async function simulate(seed: number): Promise<void> {
  const random = generator(seed);
  let clock = 1_000_000;
  const local = faultyStorage();
  const backend = memoryBackend();
  const ctx: ProtocolContext = { local, backend, now: () => clock };
  const tabs: Tab[] = TABS.map((tab) => ({ tab, instance: `${tab}-1`, open: true }));
  let lifetimes = 1;
  let written = 0;
  const steps: string[] = [];
  /** Text that must still be in some record, with the workspace it was written for. */
  const required = new Map<string, string>();

  const me = (tab: Tab): Me => ({ tab: tab.tab, instance: tab.instance });
  const fail = (message: string): never => {
    throw new InvariantBroken(`seed ${seed}: ${message}\nsteps:\n  ${steps.join('\n  ')}`);
  };

  /** Every record's text, by key. */
  const records = (): Map<string, string> => {
    const found = new Map<string, string>();
    for (const key of local.keys()) {
      if (!key.startsWith(RECORD_PREFIX)) continue;
      const raw = local.get(key);
      if (raw === null) continue;
      const text = (JSON.parse(raw) as { payload?: { text?: string } }).payload?.text;
      if (typeof text === 'string') found.set(key, text);
    }
    return found;
  };
  const ownText = (tab: Tab, workspace: string) =>
    records().get(recordKey(FEATURE, tab.tab, workspace)) ?? null;

  const write = (tab: Tab, workspace: string) => {
    const previous = ownText(tab, workspace);
    const text = `w${(written += 1)}`;
    local.set(
      recordKey(FEATURE, tab.tab, workspace),
      JSON.stringify(
        makeEnvelope(
          { feature: FEATURE, tab: tab.tab, workspace },
          { title: 't', text, baseline: null },
          clock,
        ),
      ),
    );
    if (previous !== null) required.delete(previous);
    required.set(text, workspace);
  };

  /** Invariant 2: restored text is in exactly one record no tombstone hides. */
  const visibleOnce = (text: string, claimant: Tab, workspace: string) => {
    const holders = [...records()]
      .filter(([key, value]) => value === text && !backend.entries.has(`gone:${key}`))
      .map(([key]) => key);
    const expected = recordKey(FEATURE, claimant.tab, workspace);
    if (holders.length !== 1 || holders[0] !== expected)
      fail(
        `restored "${text}" is visible in ${JSON.stringify(holders)}, expected only ${expected}`,
      );
  };

  /** Restore what this tab is offered, checking invariants 2 and 3. */
  const restore = async (
    tab: Tab,
    workspace: string,
    accept: (key: string) => Promise<void> = async () => undefined,
  ) => {
    const found = await findOffer(ctx, me(tab), FEATURE, workspace, textDraftCodec, worth);
    if (!found.offer) return;
    const ownBefore = ownText(tab, workspace);
    const offered = found.offer.envelope.payload.text;
    await accept(found.offer.key);
    const result = await acceptOffer(ctx, me(tab), found.offer.key, textDraftCodec);
    const ownAfter = ownText(tab, workspace);
    if (![...records().values()].includes(offered))
      fail(`a ${result.status} restore by ${tab.tab} destroyed the offered "${offered}"`);
    if (result.status === 'ok') {
      if (ownBefore !== null) fail(`a restore overwrote ${tab.tab}'s own "${ownBefore}"`);
      visibleOnce(result.payload.text, tab, workspace);
      // The text moved: it is required where it is now, under this workspace.
      required.set(result.payload.text, workspace);
    } else if (ownBefore !== ownAfter) {
      fail(`a ${result.status} restore changed ${tab.tab}'s own "${ownBefore}" to "${ownAfter}"`);
    }
  };

  /** The old build's single-slot value, if any. */
  const legacyText = (): string | null => {
    const raw = local.get(LEGACY_KEY);
    if (raw === null) return null;
    return (JSON.parse(raw) as { text?: string }).text ?? null;
  };
  /** Old-build drafts that must still be somewhere: the slot or a record. */
  const legacyRequired = new Set<string>();

  const restoreLegacy = async (tab: Tab, stallWith: Tab | null, looksTwice = false) => {
    const found = await findLegacy(ctx, FEATURE, LEGACY);
    if (!found) return;
    const ownBefore = ownText(tab, SCRATCH);
    if (stallWith) {
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) {
          backend.delay = () => Promise.resolve();
          clock += CLAIM_LEASE_MS + 1;
          await findLegacy(ctx, FEATURE, LEGACY);
          // A second look clears a journal that was consumed and emptied.
          if (looksTwice) await findLegacy(ctx, FEATURE, LEGACY);
        }
      };
    }
    try {
      const result = await acceptLegacy(ctx, me(tab), FEATURE, SCRATCH, LEGACY);
      const text = found.payload.text;
      if (legacyText() !== text && ![...records().values()].includes(text))
        fail(`a ${result.status} legacy restore by ${tab.tab} destroyed "${text}"`);
      if (result.status === 'ok') {
        if (ownBefore !== null) fail(`a legacy restore overwrote ${tab.tab}'s own "${ownBefore}"`);
        required.set(text, SCRATCH);
        legacyRequired.delete(text);
      } else if (ownText(tab, SCRATCH) !== ownBefore) {
        fail(`a ${result.status} legacy restore changed ${tab.tab}'s own scratch draft`);
      }
    } finally {
      backend.delay = () => Promise.resolve();
    }
  };

  /** Invariant 6: the claimant works while its restore runs. Returns what happened. */
  const restoreWhileWorking = async (tab: Tab, workspace: string, legacy: boolean) => {
    let offered: string;
    let start: (unchanged: () => boolean) => Promise<AcceptResult<TextDraft>>;
    if (legacy) {
      const found = await findLegacy(ctx, FEATURE, LEGACY);
      if (!found) return 'nothing offered';
      offered = found.payload.text;
      start = (unchanged) => acceptLegacy(ctx, me(tab), FEATURE, workspace, LEGACY, unchanged);
    } else {
      const found = await findOffer(ctx, me(tab), FEATURE, workspace, textDraftCodec, worth);
      if (!found.offer) return 'nothing offered';
      offered = found.offer.envelope.payload.text;
      const key = found.offer.key;
      start = (unchanged) => acceptOffer(ctx, me(tab), key, textDraftCodec, unchanged);
    }
    // After the claim commits, just before the completing transaction, or
    // after its callback ran but before its commit fails; written by the
    // mirror, or only changed on screen.
    const when = random.pick([
      'after the claim',
      'before it completes',
      'as its commit fails',
    ] as const);
    const mirrored = random.chance(0.5);
    let edited = false;
    let typed: string | null = null;
    const work = () => {
      if (mirrored) {
        write(tab, workspace);
        typed = ownText(tab, workspace);
      } else edited = true;
    };
    const run = backend.run;
    let calls = 0;
    backend.run = async (job) => {
      if (calls === 1 && when === 'before it completes') work();
      if (calls === 1 && when === 'as its commit fails') {
        backend.failNext = 1;
        calls += 1;
        try {
          return await run(job);
        } finally {
          work();
        }
      }
      const result = await run(job);
      calls += 1;
      if (calls === 1 && when === 'after the claim') work();
      return result;
    };
    let result: AcceptResult<TextDraft>;
    try {
      result = await start(() => !edited);
    } finally {
      backend.run = run;
    }
    const did = `${mirrored ? 'writes' : 'types'} ${when}: ${result.status}`;
    if (typed !== null || edited) {
      if (result.status === 'ok') fail(`a restore by ${tab.tab} replaced work done while it ran`);
      if (typed !== null && ownText(tab, workspace) !== typed)
        fail(`a restore by ${tab.tab} lost "${typed}", written while it ran`);
    }
    const kept = [...records().values()].includes(offered) || (legacy && legacyText() === offered);
    if (!kept) fail(`a ${result.status} restore by ${tab.tab} destroyed the offered "${offered}"`);
    return did;
  };

  /** Closed tabs that came back during this step: their records changed while closed. */
  const cameBack = new Set<Tab>();
  /** A closed tab comes back: a new page lifetime. */
  const comeBack = async (tab: Tab) => {
    tab.instance = `${tab.tab}-${(lifetimes += 1)}`;
    tab.open = true;
    cameBack.add(tab);
    await registerLifetime(ctx, me(tab));
  };

  /**
   * A claimant stalls past its lease mid-transfer (after its claim, before or
   * after writing its copy), and another tab sweeps or looks for an offer
   * meanwhile, which reconciles the stalled claim. Then, sometimes, the closed
   * tab comes back, which clears every record of what was decided about its
   * drafts.
   */
  const stalledRestore = async (actor: Tab, workspace: string) => {
    const other = tabs.find((tab) => tab !== actor && tab.open);
    const sweeps = random.chance(0.5);
    const returns = random.chance(0.4);
    let label = `${actor.tab} restores ${workspace}, stalling while ${other?.tab ?? 'nobody'} ${sweeps ? 'sweeps' : 'looks for an offer'}${returns ? ', and the closed tab comes back' : ''}`;
    try {
      await restore(actor, workspace, async (key) => {
        // Armed once the offer is found: the claim is this tab's first
        // transaction from here, the completion its second.
        let calls = 0;
        backend.delay = async () => {
          calls += 1;
          if (calls === 2 && other) {
            backend.delay = () => Promise.resolve();
            clock += CLAIM_LEASE_MS + 1;
            if (sweeps) await sweep(ctx, me(other), features);
            else await findOffer(ctx, me(other), FEATURE, workspace, textDraftCodec, worth);
            const source = tabs.find((tab) => tab.tab === parseRecordKey(key)?.tab);
            if (returns && source && !source.open) await comeBack(source);
          }
        };
      });
    } catch (error) {
      if (error instanceof InvariantBroken) throw error;
      label += ` (threw: ${error instanceof Error ? error.message : String(error)})`;
    } finally {
      backend.delay = () => Promise.resolve();
    }
    return label;
  };

  for (let step = 0; step < STEPS; step += 1) {
    cameBack.clear();
    const actor = random.pick(tabs);
    const workspace = random.pick(WORKSPACES);
    const before = records();
    const choice = random.int(15);
    let label = '';

    try {
      if (choice <= 2 && actor.open) {
        label = `${actor.tab} writes ${workspace}`;
        write(actor, workspace);
      } else if (choice === 3 && actor.open) {
        label = `${actor.tab} clears ${workspace}`;
        const text = ownText(actor, workspace);
        local.remove(recordKey(FEATURE, actor.tab, workspace));
        if (text !== null) required.delete(text);
      } else if (choice === 4 && actor.open) {
        label = `${actor.tab} closes`;
        writeDeparture(local, me(actor), clock);
        actor.open = false;
      } else if (choice === 5 && !actor.open) {
        label = `${actor.tab} comes back`;
        await comeBack(actor);
        cameBack.delete(actor);
      } else if (choice === 6) {
        const pick = random.pick([1_000, OFFER_GRACE_MS, CLAIM_LEASE_MS + 1, PRUNE_GRACE_MS + 1]);
        label = `time passes ${pick} ms`;
        clock += pick;
      } else if (choice === 7 && actor.open) {
        const fault = random.int(4);
        label = `${actor.tab} restores ${workspace}${['', ' (copy refused)', ' (commit fails)', ''][fault]}`;
        if (fault === 1) local.failKey = recordKey(FEATURE, actor.tab, workspace);
        if (fault === 2) backend.failNext = 1 + random.int(2);
        try {
          await restore(actor, workspace);
        } finally {
          local.failKey = null;
          backend.failNext = 0;
        }
      } else if (choice === 8 && actor.open) {
        // Two tabs race for the same offer.
        const rival = tabs.find((tab) => tab !== actor && tab.open);
        label = `${actor.tab} and ${rival?.tab ?? 'nobody'} race to restore ${workspace}`;
        if (rival) {
          const found = await findOffer(ctx, me(actor), FEATURE, workspace, textDraftCodec, worth);
          if (found.offer) {
            const results = await Promise.all([
              acceptOffer(ctx, me(actor), found.offer.key, textDraftCodec),
              acceptOffer(ctx, me(rival), found.offer.key, textDraftCodec),
            ]);
            const winners = results.filter((result) => result.status === 'ok');
            if (winners.length > 1)
              fail(`both racers restored "${found.offer.envelope.payload.text}"`);
            const won = results.findIndex((result) => result.status === 'ok');
            const winner = won === 0 ? actor : won === 1 ? rival : null;
            const result = results[won];
            if (winner && result?.status === 'ok') {
              visibleOnce(result.payload.text, winner, workspace);
              required.set(result.payload.text, workspace);
            }
          }
        }
      } else if (choice === 9 && actor.open) {
        label = await stalledRestore(actor, workspace);
      } else if (choice === 10 && actor.open) {
        if (random.chance(0.5)) {
          label = `${actor.tab} dismisses the ${workspace} offer`;
          const found = await findOffer(ctx, me(actor), FEATURE, workspace, textDraftCodec, worth);
          if (found.offer) await dismissOffer(ctx, found.offer.key, found.offer.srcInstance);
        } else {
          label = `${actor.tab} sweeps`;
          await sweep(ctx, me(actor), features);
        }
      } else if (choice === 11) {
        // A tab still on the build before PLAN-43 writes its single slot.
        const previous = legacyText();
        const text = `L${(written += 1)}`;
        label = `an old build writes the legacy slot`;
        local.set(LEGACY_KEY, JSON.stringify({ title: 'Old', text, savedAt: clock }));
        if (previous !== null) legacyRequired.delete(previous);
        legacyRequired.add(text);
      } else if (choice === 12 && actor.open) {
        const what = random.int(3);
        const other = tabs.find((tab) => tab !== actor && tab.open) ?? null;
        if (what === 2) {
          label = `${actor.tab} dismisses the legacy offer`;
          const found = await findLegacy(ctx, FEATURE, LEGACY);
          if (found) await dismissLegacy(ctx, FEATURE, found.hash);
        } else {
          const twice = random.chance(0.5);
          label = `${actor.tab} restores the legacy draft${what === 1 ? `, stalling while ${other?.tab ?? 'nobody'} looks${twice ? ' twice' : ''}` : ''}`;
          await restoreLegacy(actor, what === 1 ? other : null, twice);
        }
      } else if (choice === 13 && actor.open) {
        const legacy = random.chance(0.3);
        const where = legacy ? SCRATCH : workspace;
        label = `${actor.tab} restores ${legacy ? 'the legacy draft' : where} and works meanwhile`;
        label += ` (${await restoreWhileWorking(actor, where, legacy)})`;
      } else if (choice === 14 && actor.open) {
        // The hand-off a stalled restore needs, set up on purpose (by chance
        // it is rare): the other two tabs open, one writes and closes and is
        // gone past the grace; then the stall, with the third one sweeping.
        const [source, helper] = random.chance(0.5)
          ? tabs.filter((tab) => tab !== actor)
          : tabs.filter((tab) => tab !== actor).reverse();
        if (source && helper) {
          for (const tab of [source, helper]) {
            if (tab.open) continue;
            await comeBack(tab);
            // Coming back changes none of its records.
            cameBack.delete(tab);
          }
          write(source, workspace);
          writeDeparture(local, me(source), clock);
          source.open = false;
          clock += OFFER_GRACE_MS;
          label = `${source.tab} writes ${workspace} and closes; ${await stalledRestore(actor, workspace)}`;
        }
      } else {
        label = `${actor.tab} idles`;
      }
    } catch (error) {
      // Injected faults may surface as a rejected coordination call; the
      // invariants below must hold all the same. A check that failed inside
      // the step is not one of them.
      if (error instanceof InvariantBroken) throw error;
      label += ` (threw: ${error instanceof Error ? error.message : String(error)})`;
    }
    steps.push(label);

    const after = records();
    // Invariant 4: nobody else changed an open tab's records.
    for (const tab of tabs) {
      if (tab === actor || !tab.open || cameBack.has(tab)) continue;
      for (const [key, text] of before) {
        if (parseRecordKey(key)?.tab !== tab.tab) continue;
        if (after.get(key) !== text) fail(`${label} changed open ${tab.tab}'s ${key} ("${text}")`);
      }
    }
    // Invariant 5, for the old build's drafts: in its slot, or taken into a record.
    const slot = legacyText();
    for (const text of legacyRequired) {
      if (slot !== text && ![...after.values()].includes(text))
        fail(`the old build's "${text}" was lost by: ${label}`);
    }
    // Invariant 1: every required text is somewhere. Only a sweep prunes,
    // and only while a newer draft remains in that workspace.
    const present = new Set(after.values());
    const swept = label.includes('sweeps');
    for (const [text, workspace] of [...required]) {
      if (present.has(text)) continue;
      if (!swept) fail(`"${text}" (${workspace}) was lost by: ${label}`);
      const remaining = [...after.keys()].filter(
        (key) => parseRecordKey(key)?.workspace === workspace,
      );
      if (remaining.length === 0)
        fail(`"${text}" (${workspace}) is gone and nothing newer remains there`);
      // Pruned in favour of a newer draft: no longer required.
      required.delete(text);
    }
  }
}

describe('draft protocol under random schedules (PLAN-43)', () => {
  const only = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.SEEDS;
  const seeds = only
    ? only.split(',').map(Number)
    : Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

  it(`keeps every invariant over ${seeds.length} seeded runs of ${STEPS} steps`, async () => {
    for (const seed of seeds) await simulate(seed);
    expect(seeds.length).toBeGreaterThan(0);
  });
});
