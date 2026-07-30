import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FeatureModule } from '../../core/module.js';
import { diskUsage, totalBytes } from '../../core/disk-usage.js';
import { createMetricsRegistry } from './registry.js';
import { MetricsSampler } from './sampler.js';

/**
 * metrics — a periodic runtime snapshot written straight into the log stream
 * (PLAN-16b).
 *
 * **The snapshot is the record; Prometheus and Tempo are accelerators.** Alloy's
 * backfill guarantee is a property of *tailing files*, not of the stack:
 * Prometheus scrapes (down means the data never existed), and Tempo is pushed to
 * (down means the exporter buffers, retries, drops). The owner runs Docker far
 * less often than Bifrost, so anything that only exists while a container is up
 * cannot answer "why did it hang at 3am last Tuesday?". Writing the numbers as
 * log lines inherits the existing files-first backfill for free.
 *
 * Cost is negligible: at the default interval that is ~1,440 lines a day, around
 * 0.4 MB against a 20 MB rotation cap.
 *
 * Registered in BOTH profiles.
 */
export const metricsModule: FeatureModule = {
  name: 'metrics',
  register(app, deps) {
    const { config, log, bus, sse } = deps;
    if (!config.metrics.enabled) {
      log.info('metrics snapshots disabled (METRICS_ENABLED=false)');
      return;
    }

    // Pinned at trace, on purpose. Snapshots are log lines, so raising LOG_LEVEL
    // to warn or error — the escape hatch this plan deliberately keeps — would
    // otherwise silently stop the metrics record and destroy the "survives with
    // zero Docker dependency" premise. A trace-pinned child is unaffected by the
    // root level, which leaves METRICS_ENABLED as the one intended off-switch.
    const snapshotLog = log.child({}, { level: 'trace' });

    // resolution 20ms: fine enough to catch a block worth caring about, coarse
    // enough that the histogram itself is not the load.
    const loopLag = monitorEventLoopDelay({ resolution: 20 });
    loopLag.enable();

    const sampler = new MetricsSampler({
      cpuUsage: () => process.cpuUsage(),
      memoryUsage: () => process.memoryUsage(),
      loopLag,
      sseClients: () => sse.clientCount,
      uptimeSec: () => process.uptime(),
      now: () => Date.now(),
    });

    // Deltas come from the bus, never from another module's tables — metrics
    // owns no data of its own and imports nobody.
    const registry = createMetricsRegistry();

    const unsubscribe = bus.on('file.uploaded', () => {
      sampler.recordUpload();
      registry.recordUpload();
    });

    const folders = [
      { folder: 'uploads', dir: config.storage.uploads },
      { folder: 'downloads', dir: config.storage.downloads },
      { folder: 'logs', dir: config.storage.logs },
      { folder: 'data', dir: config.storage.data },
    ];

    const sampleDisk = (): void => {
      // Synchronous and recursive — see core/disk-usage. This is exactly why it
      // is on its own slow timer instead of riding the snapshot interval.
      sampler.setDiskBytes(totalBytes(diskUsage(folders, log)));
    };
    sampleDisk();

    const snapshotTimer = setInterval(() => {
      const snapshot = sampler.sample();
      snapshotLog.trace(snapshot, 'snapshot');
      // Same numbers, second format. Prometheus scrapes a *current* value, so
      // the gauges only ever mirror what the durable line already said.
      registry.publish(snapshot);
    }, config.metrics.snapshotIntervalSec * 1000);
    const diskTimer = setInterval(sampleDisk, config.metrics.diskIntervalSec * 1000);

    // Neither timer may hold the process open: a stopped Bifrost must exit, not
    // linger because a sampler is still scheduled.
    snapshotTimer.unref();
    diskTimer.unref();

    // Unauthenticated on the LAN, on purpose: Prometheus has no session, so
    // requireAdmin would simply break scraping. This matches the existing LAN
    // trust model — a bearer token from .env is the escape hatch if that
    // changes. It exposes counters and gauges, never any content.
    app.get('/metrics', async (_request, reply) => {
      reply.header('content-type', registry.contentType);
      return registry.scrape();
    });

    // The latency histogram has to see EVERY route, and a Fastify hook only
    // ever sees the encapsulation context it was added in — each module lives
    // in its own, so no hook this module could register would observe another
    // module's routes. core/http emits one bus event per finished request
    // instead, which is the architecture's own answer and keeps prom-client out
    // of core.
    const unobserve = bus.on('http.requestCompleted', (event) => {
      registry.observeRequest(
        { route: event.route, method: event.method, status: event.statusCode },
        event.durationMs / 1000,
      );
    });

    app.addHook('onClose', () => {
      clearInterval(snapshotTimer);
      clearInterval(diskTimer);
      loopLag.disable();
      unsubscribe();
      unobserve();
    });

    log.info(
      {
        snapshotIntervalSec: config.metrics.snapshotIntervalSec,
        diskIntervalSec: config.metrics.diskIntervalSec,
      },
      'metrics snapshots armed',
    );
  },
};
