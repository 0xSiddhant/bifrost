import type { FeatureModule } from '../../core/module.js';
import { TestGuard } from './guard.js';
import { registerNimbusRoutes } from './routes/nimbus.js';
import { DbNimbusRepository } from './services/db-nimbus-repository.js';
import { createPayloadPool, createPayloadStream } from './services/payload-pool.js';
import {
  ListResultsUseCase,
  PruneResultsUseCase,
  SaveResultUseCase,
} from './usecases/record-results.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many ping round trips one test takes. The median of them is the reported
 * latency — a mean would be dragged upward by a single Wi-Fi retry spike, which
 * is exactly the sort of thing that happens on the path this tool measures.
 * Advertised through /api/nimbus/config so the page and its methodology note
 * quote the server's number rather than their own copy of it.
 */
const PING_SAMPLES = 10;

/**
 * Nimbus (PLAN-14): the LAN speed test. Measures the path that actually matters
 * in the house — this device ↔ the Bifrost Mac over Wi-Fi — rather than the ISP
 * link every internet speed test reports.
 *
 * The measurement lives on both sides by design: the server streams and sinks
 * bytes (and refuses to do two tests at once), while the client owns the timing,
 * because the number a person cares about is the one their own device sees.
 *
 * Local profile only, self-evidently — a speed test against a server across the
 * internet is a different tool, and an open byte-firehose on a public host is a
 * bandwidth-bill generator.
 */
export const nimbusModule: FeatureModule = {
  name: 'nimbus',
  register(app, deps) {
    const { config, log, db, bus, sse } = deps;

    const repo = new DbNimbusRepository(db);
    const guard = new TestGuard();
    // One pool for the process; every download is a window onto it.
    const pool = createPayloadPool();

    const prune = new PruneResultsUseCase(repo, config.auditRetentionDays);
    const prunedAtBoot = prune.execute();
    if (prunedAtBoot > 0) log.info({ pruned: prunedAtBoot }, 'nimbus: pruned expired results');

    const offCompleted = bus.on('nimbus.completed', (payload) =>
      sse.broadcast('nimbus.completed', payload),
    );

    const timer = setInterval(() => {
      const pruned = prune.execute();
      if (pruned > 0) log.info({ pruned }, 'nimbus: pruned expired results');
    }, DAY_MS);
    timer.unref();

    app.addHook('onClose', () => {
      clearInterval(timer);
      offCompleted();
    });

    registerNimbusRoutes(app, {
      guard,
      maxTestMb: config.nimbus.maxTestMb,
      pingSamples: PING_SAMPLES,
      payloadStream: (bytes) => createPayloadStream(pool, bytes),
      save: new SaveResultUseCase(repo, bus, config.nimbus.maxTestMb),
      list: new ListResultsUseCase(repo),
    });
  },
};
