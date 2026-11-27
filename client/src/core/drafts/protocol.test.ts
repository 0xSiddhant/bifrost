import { beforeEach, describe, expect, it } from 'vitest';
import { memoryBackend } from './coordinator';
import { textDraftCodec, legacyTextParse, type TextDraft } from './documents';
import {
  CLAIM_LEASE_MS,
  OFFER_GRACE_MS,
  PRUNE_GRACE_MS,
  acceptLegacy,
  acceptOffer,
  dismissLegacy,
  dismissOffer,
  findLegacy,
  findOffer,
  registerLifetime,
  releaseLifetime,
  sweep,
  writeDeparture,
  type Me,
  type ProtocolContext,
} from './protocol';
import { SCRATCH, leftKey, makeEnvelope, recordKey, type DraftFeature } from './records';
import { memoryStorage } from './storage';

const A: Me = { tab: 'tab-a', instance: 'a1' };
const B: Me = { tab: 'tab-b', instance: 'b1' };
const C: Me = { tab: 'tab-c', instance: 'c1' };

const draft = (text: string, title = 'T'): TextDraft => ({ title, text, baseline: null });
const worth = (payload: TextDraft) => payload.text.trim() !== '';
const LEGACY = legacyTextParse((text) => text.trim() === '');

describe('draft protocol (PLAN-43)', () => {
  let clock: number;
  let local: ReturnType<typeof memoryStorage>;
  let backend: ReturnType<typeof memoryBackend>;
  let ctx: ProtocolContext;

  const put = (
    me: Me,
    text: string,
    workspace = SCRATCH,
    feature: DraftFeature = 'runestone',
    savedAt = clock,
  ) =>
    local.set(
      recordKey(feature, me.tab, workspace),
      JSON.stringify(makeEnvelope({ feature, tab: me.tab, workspace }, draft(text), savedAt)),
    );
  const read = (me: Me, workspace = SCRATCH, feature: DraftFeature = 'runestone') =>
    local.get(recordKey(feature, me.tab, workspace));
  const textOf = (me: Me, workspace = SCRATCH, feature: DraftFeature = 'runestone') => {
    const raw = read(me, workspace, feature);
    return raw === null ? null : (JSON.parse(raw) as { payload: TextDraft }).payload.text;
  };
  const leave = (me: Me) => writeDeparture(local, me, clock);
  const offerFor = (me: Me, workspace = SCRATCH) =>
    findOffer(ctx, me, 'runestone', workspace, textDraftCodec, worth);

  beforeEach(async () => {
    clock = 1_000_000;
    local = memoryStorage();
    backend = memoryBackend();
    ctx = { local, backend, now: () => clock };
    for (const me of [A, B, C]) await registerLifetime(ctx, me);
  });

  describe('isolation', () => {
    it('keys every tab, editor and workspace apart', () => {
      put(A, 'a-scratch');
      put(B, 'b-scratch');
      put(A, 'a-doc', 'doc:1');
      put(A, 'a-edda', SCRATCH, 'edda');
      expect([textOf(A), textOf(B), textOf(A, 'doc:1'), textOf(A, SCRATCH, 'edda')]).toEqual([
        'a-scratch',
        'b-scratch',
        'a-doc',
        'a-edda',
      ]);
    });
  });

  describe('known closed', () => {
    it('offers nothing from a tab that never left', async () => {
      put(A, 'live work');
      clock += OFFER_GRACE_MS * 10;
      expect((await offerFor(B)).offer).toBeNull();
    });

    it('offers the newest closed draft, not the first in key order', async () => {
      // tab-b sorts before tab-c; tab-c left later, with newer work.
      put(B, 'older');
      leave(B);
      clock += 1000;
      put(C, 'newer');
      leave(C);
      clock += OFFER_GRACE_MS;
      expect((await offerFor(A)).offer?.envelope.payload.text).toBe('newer');
    });

    it('offers nothing older while the newest departure is still within the grace', async () => {
      put(B, 'older');
      leave(B);
      clock += OFFER_GRACE_MS;
      put(C, 'newer');
      leave(C);
      const early = await offerFor(A);
      expect(early.offer).toBeNull();
      expect(early.recheckAt).toBe(clock + OFFER_GRACE_MS);
    });

    it('waits out the grace after a departure, saying when to look again', async () => {
      put(A, 'closing');
      leave(A);
      clock += OFFER_GRACE_MS - 1;
      const early = await offerFor(B);
      expect(early.offer).toBeNull();
      expect(early.recheckAt).toBe(clock + 1);
      clock += 1;
      expect((await offerFor(B)).offer?.envelope.payload.text).toBe('closing');
    });

    it('never treats a reloaded tab as closed: its new lifetime is registered', async () => {
      put(A, 'reloading');
      leave(A);
      await registerLifetime(ctx, { tab: A.tab, instance: 'a2' });
      // Even if B still sees the old marker (a stale read), the registry disagrees.
      writeDeparture(local, A, clock);
      clock += OFFER_GRACE_MS * 10;
      expect((await offerFor(B)).offer).toBeNull();
    });

    it('cannot confirm a tab that never registered (no IndexedDB there)', async () => {
      const ghost: Me = { tab: 'tab-ghost', instance: 'g1' };
      put(ghost, 'unconfirmed');
      leave(ghost);
      clock += OFFER_GRACE_MS * 10;
      expect((await offerFor(B)).offer).toBeNull();
    });

    it('offers only the same workspace, never this tab’s own, and only what is worth it', async () => {
      put(A, 'other doc', 'doc:9');
      put(A, '   ');
      leave(A);
      clock += OFFER_GRACE_MS;
      expect((await offerFor(B)).offer).toBeNull();
      expect((await offerFor(B, 'doc:9')).offer?.envelope.payload.text).toBe('other doc');
      expect((await offerFor(A, 'doc:9')).offer).toBeNull();
    });

    it('picks the first eligible record in key order', async () => {
      put(C, 'from c');
      put(B, 'from b');
      leave(B);
      leave(C);
      clock += OFFER_GRACE_MS;
      expect((await offerFor(A)).offer?.key).toBe(recordKey('runestone', B.tab, SCRATCH));
    });

    it('ignores a corrupt record and leaves it in place', async () => {
      local.set(recordKey('runestone', B.tab, SCRATCH), '{"v":1,"broken":');
      leave(B);
      clock += OFFER_GRACE_MS;
      expect((await offerFor(A)).offer).toBeNull();
      expect(read(B)).toBe('{"v":1,"broken":');
    });
  });

  describe('transfer', () => {
    beforeEach(() => {
      put(B, 'closed work');
      leave(B);
      clock += OFFER_GRACE_MS;
    });

    it('moves the draft once: written and verified here, removed there', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      const result = await acceptOffer(ctx, A, key, textDraftCodec);
      expect(result).toMatchObject({ status: 'ok', payload: { text: 'closed work' } });
      expect(textOf(A)).toBe('closed work');
      expect(read(B)).toBeNull();
      expect((await offerFor(C)).offer).toBeNull();
      expect(await acceptOffer(ctx, C, key, textDraftCodec)).toEqual({ status: 'gone' });
    });

    it('never overwrites a draft this tab already holds for the workspace', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      put(A, 'typed here meanwhile');
      expect(await acceptOffer(ctx, A, key, textDraftCodec)).toEqual({ status: 'own' });
      expect(textOf(A)).toBe('typed here meanwhile');
      expect(textOf(B)).toBe('closed work');
      expect(backend.entries.has(`gone:${key}`)).toBe(false);
    });

    describe('this tab’s newer work, during the restore (Codex on #122)', () => {
      const key = () => recordKey('runestone', B.tab, SCRATCH);
      /** Run `then` right after the `n`th transaction commits, before the restore goes on. */
      const afterCommit = (n: number, then: () => void) => {
        const run = backend.run;
        let calls = 0;
        backend.run = async (work) => {
          const result = await run(work);
          calls += 1;
          if (calls === n) then();
          return result;
        };
        return () => {
          backend.run = run;
        };
      };
      /** Run `then` just before the `n`th transaction starts. */
      const beforeRun = (n: number, then: () => void) => {
        let calls = 0;
        backend.delay = async () => {
          calls += 1;
          if (calls === n) then();
        };
      };
      const offeredAgain = async () => (await offerFor(C)).offer?.key;

      it('never overwrites a draft the mirror wrote while the claim was committing', async () => {
        const restore = afterCommit(1, () => put(A, 'typed while restoring'));
        const result = await acceptOffer(ctx, A, key(), textDraftCodec);
        restore();
        expect(result).toEqual({ status: 'own' });
        expect(textOf(A)).toBe('typed while restoring');
        expect(textOf(B)).toBe('closed work');
        expect(backend.entries.has(`gone:${key()}`)).toBe(false);
        expect(await offeredAgain()).toBe(key());
      });

      it('stands down when the buffer changed on screen before the copy went in', async () => {
        let edited = false;
        const restore = afterCommit(1, () => {
          edited = true;
        });
        const result = await acceptOffer(ctx, A, key(), textDraftCodec, () => !edited);
        restore();
        expect(result).toEqual({ status: 'own' });
        expect(read(A)).toBeNull();
        expect(textOf(B)).toBe('closed work');
        expect(await offeredAgain()).toBe(key());
      });

      it('withdraws its copy when the buffer changed on screen before the transfer completed', async () => {
        let edited = false;
        beforeRun(2, () => {
          edited = true;
        });
        const result = await acceptOffer(ctx, A, key(), textDraftCodec, () => !edited);
        expect(result).toEqual({ status: 'own' });
        expect(read(A)).toBeNull();
        expect(textOf(B)).toBe('closed work');
        expect(await offeredAgain()).toBe(key());
      });

      it('keeps a draft the mirror wrote over the copy before the transfer completed', async () => {
        beforeRun(2, () => put(A, 'typed after the copy'));
        expect(await acceptOffer(ctx, A, key(), textDraftCodec)).toEqual({ status: 'own' });
        expect(textOf(A)).toBe('typed after the copy');
        expect(textOf(B)).toBe('closed work');
        expect(await offeredAgain()).toBe(key());
      });

      it('keeps a newer draft here when its claim was lost meanwhile', async () => {
        beforeRun(2, () => {
          backend.entries.delete(`gone:${key()}`);
          put(A, 'typed after the copy');
        });
        expect(await acceptOffer(ctx, A, key(), textDraftCodec)).toEqual({ status: 'own' });
        expect(textOf(A)).toBe('typed after the copy');
        expect(textOf(B)).toBe('closed work');
      });

      it('puts its copy back when an earlier mirror tick removed it, then completes', async () => {
        beforeRun(2, () => local.remove(recordKey('runestone', A.tab, SCRATCH)));
        const result = await acceptOffer(ctx, A, key(), textDraftCodec);
        expect(result).toMatchObject({ status: 'ok', payload: { text: 'closed work' } });
        expect(textOf(A)).toBe('closed work');
        expect(read(B)).toBeNull();
      });

      it('stands down when the buffer changed and the completing commit failed', async () => {
        let edited = false;
        beforeRun(2, () => {
          edited = true;
          backend.failNext = 1;
        });
        const result = await acceptOffer(ctx, A, key(), textDraftCodec, () => !edited);
        backend.delay = () => Promise.resolve();
        expect(result).toEqual({ status: 'own' });
        expect(read(A)).toBeNull();
        // The claim outlives the failed commit; past its lease, nothing here
        // matches it, so it is released and the draft is offered again.
        clock += CLAIM_LEASE_MS + 1;
        expect(await offeredAgain()).toBe(key());
        expect(textOf(B)).toBe('closed work');
      });
    });

    it('counts a transfer another tab completed for it during a stall as done, keeping the copy', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      const runestone = { runestone: { codec: textDraftCodec as (raw: unknown) => unknown } };
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        // Before this tab marks its claim done, it stalls past the lease and
        // another tab's sweep reconciles the claim from the verified copy.
        if (calls === 2) {
          clock += CLAIM_LEASE_MS + 1;
          await sweep(ctx, C, runestone);
        }
      };
      const result = await acceptOffer(ctx, A, key, textDraftCodec);
      backend.delay = () => Promise.resolve();
      expect(result).toMatchObject({ status: 'ok', payload: { text: 'closed work' } });
      expect(textOf(A)).toBe('closed work');
      expect(read(B)).toBeNull();
    });

    it('does not offer a dismissed draft again, in any tab, while its tab stays closed', async () => {
      const found = (await offerFor(A)).offer;
      expect(found?.envelope.payload.text).toBe('closed work');
      await dismissOffer(ctx, found!.key, found!.srcInstance);
      expect((await offerFor(A)).offer).toBeNull();
      expect((await offerFor(C)).offer).toBeNull();
      // Dismissed, not deleted: the draft stays where it is.
      expect(textOf(B)).toBe('closed work');
      // The tab comes back and closes again: its draft counts afresh.
      const again: Me = { tab: B.tab, instance: 'b2' };
      await registerLifetime(ctx, again);
      writeDeparture(local, again, clock);
      clock += OFFER_GRACE_MS;
      expect((await offerFor(A)).offer?.envelope.payload.text).toBe('closed work');
    });

    it('lets exactly one of two racing tabs take it', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      const results = await Promise.all([
        acceptOffer(ctx, A, key, textDraftCodec),
        acceptOffer(ctx, C, key, textDraftCodec),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['gone', 'ok']);
      expect([textOf(A), textOf(C)].filter((text) => text === 'closed work')).toHaveLength(1);
    });

    it('keeps the source and releases the claim when this tab cannot write', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      const quota = new DOMException('full', 'QuotaExceededError');
      const realSet = local.set;
      local.set = (k, v) => {
        if (k === recordKey('runestone', A.tab, SCRATCH)) throw quota;
        realSet(k, v);
      };
      expect(await acceptOffer(ctx, A, key, textDraftCodec)).toEqual({
        status: 'failed',
        reason: 'browser storage is full',
      });
      local.set = realSet;
      expect(read(B)).not.toBeNull();
      expect((await offerFor(C)).offer?.key).toBe(key);
    });

    it('fails, touching nothing, when the claim cannot commit', async () => {
      backend.failNext = 1;
      const key = recordKey('runestone', B.tab, SCRATCH);
      const result = await acceptOffer(ctx, A, key, textDraftCodec);
      expect(result.status).toBe('failed');
      expect(read(A)).toBeNull();
      expect(read(B)).not.toBeNull();
    });

    it('withdraws its copy when its claim was lost meanwhile', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      // The claim commits, then (this tab frozen past the lease) is released
      // by reconciliation before the completing transaction runs.
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) backend.entries.delete(`gone:${key}`);
      };
      expect(await acceptOffer(ctx, A, key, textDraftCodec)).toEqual({ status: 'gone' });
      expect(read(A)).toBeNull();
      expect(read(B)).not.toBeNull();
    });

    it('leaves the source with a tab that came back mid-transfer', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) backend.entries.set(`tab:${B.tab}`, { instance: 'b2', at: clock });
      };
      expect(await acceptOffer(ctx, A, key, textDraftCodec)).toMatchObject({ status: 'ok' });
      expect(read(B)).not.toBeNull();
    });

    it('shows the copy when only the completing commit fails, and finishes it later', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) backend.failNext = 1;
      };
      const result = await acceptOffer(ctx, A, key, textDraftCodec);
      expect(result).toMatchObject({ status: 'ok', payload: { text: 'closed work' } });
      expect(result.status === 'ok' && result.warning).toBeTruthy();
      backend.delay = () => Promise.resolve();
      // Still claimed, so offered to nobody; past the lease, reconciliation completes it.
      expect((await offerFor(C)).offer).toBeNull();
      clock += CLAIM_LEASE_MS + 1;
      await sweep(ctx, C, {});
      expect(read(B)).toBeNull();
      expect(textOf(A)).toBe('closed work');
    });

    it('releases an abandoned claim whose copy never landed', async () => {
      const key = recordKey('runestone', B.tab, SCRATCH);
      backend.entries.set(`gone:${key}`, {
        phase: 'claimed',
        reason: 'transferred',
        srcInstance: B.instance,
        at: clock,
        by: A.tab,
        instance: A.instance,
        dest: recordKey('runestone', A.tab, SCRATCH),
        hash: 'x',
      });
      expect((await offerFor(C)).offer).toBeNull();
      clock += CLAIM_LEASE_MS + 1;
      expect((await offerFor(C)).offer?.key).toBe(key);
    });
  });

  describe('sweep: newest draft wins (owner, 2026-11-26)', () => {
    const runestone = { runestone: { codec: textDraftCodec as (raw: unknown) => unknown } };

    it('prunes a closed tab’s draft once this tab has one of its own, after the prune grace', async () => {
      put(A, 'mine', 'doc:1');
      put(B, 'closed', 'doc:1');
      leave(B);
      clock += PRUNE_GRACE_MS - 1;
      expect(await sweep(ctx, A, runestone)).toBe(0);
      clock += 1;
      expect(await sweep(ctx, A, runestone)).toBe(1);
      expect(read(B, 'doc:1')).toBeNull();
      expect(textOf(A, 'doc:1')).toBe('mine');
    });

    it('decides per workspace: a scratch draft never costs a saved document’s edits', async () => {
      put(A, 'my scratch');
      put(B, 'closed scratch');
      put(B, 'closed doc edits', 'doc:1');
      put(C, 'other doc edits', 'doc:2');
      leave(B);
      leave(C);
      clock += PRUNE_GRACE_MS;
      // Only B's scratch draft has a newer one (this tab's) in its workspace.
      expect(await sweep(ctx, A, runestone)).toBe(1);
      expect(read(B)).toBeNull();
      expect(textOf(B, 'doc:1')).toBe('closed doc edits');
      expect(textOf(C, 'doc:2')).toBe('other doc edits');
    });

    it('keeps the newest closed draft when this tab has none, pruning the older', async () => {
      put(B, 'older');
      leave(B);
      clock += 1000;
      put(C, 'newer');
      leave(C);
      clock += PRUNE_GRACE_MS;
      expect(await sweep(ctx, A, runestone)).toBe(1);
      expect(read(B)).toBeNull();
      expect(textOf(C)).toBe('newer');
      // Nothing more to prune, however often it runs.
      clock += PRUNE_GRACE_MS;
      expect(await sweep(ctx, A, runestone)).toBe(0);
      expect(textOf(C)).toBe('newer');
    });

    it('never prunes every draft when tabs sweep at once', async () => {
      put(B, 'b');
      leave(B);
      put(C, 'c');
      clock += 1;
      leave(C);
      clock += PRUNE_GRACE_MS;
      const D: Me = { tab: 'tab-d', instance: 'd1' };
      await registerLifetime(ctx, D);
      await Promise.all([sweep(ctx, A, runestone), sweep(ctx, D, runestone)]);
      expect([read(B), read(C)].filter((raw) => raw !== null)).toHaveLength(1);
      expect(textOf(C)).toBe('c');
    });

    it('leaves alone a draft this tab is offering, a reclaimed tab’s and a corrupt one', async () => {
      put(A, 'mine');
      put(B, 'offered');
      leave(B);
      put(C, 'reloaded');
      leave(C);
      await registerLifetime(ctx, { tab: C.tab, instance: 'c2' });
      const D: Me = { tab: 'tab-d', instance: 'd1' };
      await registerLifetime(ctx, D);
      local.set(recordKey('runestone', D.tab, SCRATCH), 'not json');
      writeDeparture(local, D, clock);
      clock += PRUNE_GRACE_MS;
      const protect = new Set([recordKey('runestone', B.tab, SCRATCH)]);
      expect(await sweep(ctx, A, runestone, protect)).toBe(0);
      expect(textOf(B)).toBe('offered');
      expect(textOf(C)).toBe('reloaded');
      expect(read(D)).toBe('not json');
    });

    it('forgets departed tabs with nothing left, and their markers', async () => {
      leave(B);
      clock += OFFER_GRACE_MS;
      await sweep(ctx, A, runestone);
      expect(local.get(leftKey(B.tab))).toBeNull();
      expect(backend.entries.has(`tab:${B.tab}`)).toBe(false);
    });
  });

  describe('legacy single-slot drafts', () => {
    const LEGACY_KEY = 'bifrost.runestone.draft';
    const old = (text: string) => JSON.stringify({ title: 'Old', text, savedAt: 5 });

    it('offers a pre-update draft with something in it, and nothing for a blank one', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toMatchObject({
        payload: { title: 'Old', text: '{"kept":1}', baseline: null },
        savedAt: 5,
      });
      local.set(LEGACY_KEY, old('  '));
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      expect(await findLegacy(ctx, 'variant', LEGACY)).toBeNull();
    });

    it('is not offered again once dismissed, while the old key holds that value', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      const found = await findLegacy(ctx, 'runestone', LEGACY);
      await dismissLegacy(ctx, 'runestone', found!.hash);
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      // Kept, not deleted; a different value is offered on its own merits.
      expect(local.get(LEGACY_KEY)).toBe(old('{"kept":1}'));
      local.set(LEGACY_KEY, old('{"other":2}'));
      expect((await findLegacy(ctx, 'runestone', LEGACY))?.payload.text).toBe('{"other":2}');
    });

    it('never overwrites this tab’s own scratch draft with it', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      put(A, 'typed here meanwhile');
      expect(await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY)).toEqual({ status: 'own' });
      expect(textOf(A)).toBe('typed here meanwhile');
      expect(local.get(LEGACY_KEY)).toBe(old('{"kept":1}'));
    });

    it('never overwrites a draft the mirror wrote while the claim was committing', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      const run = backend.run;
      let calls = 0;
      backend.run = async (work) => {
        const result = await run(work);
        calls += 1;
        if (calls === 1) put(A, 'typed while restoring');
        return result;
      };
      const result = await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY);
      backend.run = run;
      expect(result).toEqual({ status: 'own' });
      expect(textOf(A)).toBe('typed while restoring');
      expect(local.get(LEGACY_KEY)).toBe(old('{"kept":1}'));
      expect(backend.entries.has('legacy:runestone')).toBe(false);
    });

    it('withdraws its copy when the buffer changed on screen before the transfer completed', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      let edited = false;
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) edited = true;
      };
      const result = await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY, () => !edited);
      backend.delay = () => Promise.resolve();
      expect(result).toEqual({ status: 'own' });
      expect(read(A)).toBeNull();
      expect(local.get(LEGACY_KEY)).toBe(old('{"kept":1}'));
      expect((await findLegacy(ctx, 'runestone', LEGACY))?.payload.text).toBe('{"kept":1}');
    });

    it('counts a transfer another tab completed for it during a stall as done', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) {
          clock += CLAIM_LEASE_MS + 1;
          await findLegacy(ctx, 'runestone', LEGACY);
        }
      };
      const result = await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY);
      backend.delay = () => Promise.resolve();
      expect(result).toMatchObject({ status: 'ok', payload: { text: '{"kept":1}' } });
      expect(textOf(A)).toBe('{"kept":1}');
    });

    it('moves it into one tab, once, and removes the old key only after the copy verifies', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      const result = await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY);
      expect(result).toMatchObject({ status: 'ok', payload: { text: '{"kept":1}' } });
      expect(textOf(A)).toBe('{"kept":1}');
      expect(local.get(LEGACY_KEY)).toBeNull();
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      expect(await acceptLegacy(ctx, B, 'runestone', SCRATCH, LEGACY)).toEqual({ status: 'gone' });
    });

    it('lets exactly one of two racing tabs take it', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      const results = await Promise.all([
        acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY),
        acceptLegacy(ctx, B, 'runestone', SCRATCH, LEGACY),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['gone', 'ok']);
      expect([read(A), read(B)].filter((raw) => raw !== null)).toHaveLength(1);
    });

    it('keeps the old key and offers it again when the copy cannot be written', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      const realSet = local.set;
      local.set = (k, v) => {
        if (k.startsWith('bifrost.drafts.')) throw new DOMException('no', 'SecurityError');
        realSet(k, v);
      };
      expect(await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY)).toEqual({
        status: 'failed',
        reason: 'browser storage is blocked',
      });
      local.set = realSet;
      expect(local.get(LEGACY_KEY)).toBe(old('{"kept":1}'));
      expect(await findLegacy(ctx, 'runestone', LEGACY)).not.toBeNull();
    });

    it('reconciles an interrupted transfer: completed if the copy verified, released if not', async () => {
      local.set(LEGACY_KEY, old('{"kept":1}'));
      // Interrupted after the claim committed and the copy was written: the
      // completing transaction never commits (as if the tab were killed).
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        if (calls === 2) throw new Error('tab killed');
      };
      expect(await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY)).toMatchObject({
        status: 'ok',
        warning: 'the transfer could not be marked complete (tab killed)',
      });
      backend.delay = () => Promise.resolve();
      expect(local.get(LEGACY_KEY)).not.toBeNull();
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      clock += CLAIM_LEASE_MS + 1;
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      expect(local.get(LEGACY_KEY)).toBeNull();
      expect(textOf(A)).toBe('{"kept":1}');

      // Interrupted before the copy landed: released and offered again.
      local.set(LEGACY_KEY, old('{"second":2}'));
      backend.entries.set('legacy:runestone', {
        phase: 'claimed',
        by: B.tab,
        instance: B.instance,
        dest: recordKey('runestone', B.tab, SCRATCH),
        hash: 'whatever',
        payloadHash: 'nothing',
        at: clock,
      });
      expect(await findLegacy(ctx, 'runestone', LEGACY)).toBeNull();
      clock += CLAIM_LEASE_MS + 1;
      expect((await findLegacy(ctx, 'runestone', LEGACY))?.payload.text).toBe('{"second":2}');
    });

    it('never removes a value an older tab wrote after the copy was taken, and offers it anew', async () => {
      local.set(LEGACY_KEY, old('{"first":1}'));
      let calls = 0;
      backend.delay = async () => {
        calls += 1;
        // An old-version tab, still open, writes the slot mid-transfer.
        if (calls === 2) local.set(LEGACY_KEY, old('{"later":2}'));
      };
      expect(await acceptLegacy(ctx, A, 'runestone', SCRATCH, LEGACY)).toMatchObject({
        status: 'ok',
      });
      backend.delay = () => Promise.resolve();
      expect(local.get(LEGACY_KEY)).toBe(old('{"later":2}'));
      expect((await findLegacy(ctx, 'runestone', LEGACY))?.payload.text).toBe('{"later":2}');
    });
  });

  it('registers nothing for a page that yielded its id meanwhile, and releases only its own entry', async () => {
    // A page that gave its id up to a live twin before its registration ran.
    expect(await registerLifetime(ctx, { tab: B.tab, instance: 'late' }, () => false)).toBe(false);
    expect(backend.entries.get(`tab:${B.tab}`)).toMatchObject({ instance: B.instance });
    // One that registered first, then yielded: its entry goes, a twin's stays.
    await registerLifetime(ctx, { tab: C.tab, instance: 'yielder' });
    await releaseLifetime(ctx, { tab: C.tab, instance: 'yielder' });
    expect(backend.entries.has(`tab:${C.tab}`)).toBe(false);
    await releaseLifetime(ctx, { tab: B.tab, instance: 'someone else' });
    expect(backend.entries.get(`tab:${B.tab}`)).toMatchObject({ instance: B.instance });
  });

  it('a new lifetime clears its own departure and earlier decisions about its records', async () => {
    put(A, 'x');
    leave(A);
    backend.entries.set(`gone:${recordKey('runestone', A.tab, SCRATCH)}`, {
      phase: 'done',
      reason: 'pruned',
      srcInstance: A.instance,
      at: clock,
    });
    await registerLifetime(ctx, { tab: A.tab, instance: 'a2' });
    expect(local.get(leftKey(A.tab))).toBeNull();
    expect(backend.entries.has(`gone:${recordKey('runestone', A.tab, SCRATCH)}`)).toBe(false);
    expect(backend.entries.get(`tab:${A.tab}`)).toMatchObject({ instance: 'a2' });
  });
});
