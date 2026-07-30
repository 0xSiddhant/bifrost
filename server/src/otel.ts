import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { loadDotenv } from './core/config/dotenv.js';
import { otelSettingsFromEnv } from './core/config/index.js';
import { createRateLimitedReporter } from './otel-report.js';

/**
 * OpenTelemetry tracing (PLAN-16b Step 4). Traces go to Tempo; the durable
 * record remains the metrics snapshot in the log archive, because Tempo is
 * *pushed to* — when it is down the exporter buffers, retries, and eventually
 * drops, so a trace that was never delivered simply does not exist.
 *
 * **This file must be loaded with `node --import ./dist/otel.js` — before the
 * app.** ESM hoists imports, so initialising the SDK inside `bootstrap.ts`
 * would run after Fastify, http and better-sqlite3 were already imported, and
 * the instrumentations would patch nothing. That failure is completely silent:
 * no error, no warning, just no spans. Which is why the startup line below
 * matters — its *absence* is the signal that the flag was missed.
 *
 * Off by default. A dead OTLP endpoint makes the exporter retry and log
 * connection errors into `storage/logs/`, i.e. observability tooling degrading
 * the observability record. Turn it on when the stack is up.
 */

// This file runs before the app, so nothing has loaded .env yet.
loadDotenv();
const settings = otelSettingsFromEnv();

if (settings.enabled) {
  const exporter = new OTLPTraceExporter({
    url: `${settings.endpoint.replace(/\/$/, '')}/v1/traces`,
    // Short, so a dead collector cannot hold the process at shutdown.
    timeoutMillis: settings.timeoutMs,
  });

  // Not silent (undiagnosable) and not unbounded (destroys the archive) —
  // see otel-report.ts for why that is the whole design constraint. stderr
  // rather than the app logger: pino's transport is not up yet at boot, and
  // PM2/launchd already capture stderr beside the archive.
  const report = createRateLimitedReporter({
    write: (line) => process.stderr.write(`${line}\n`),
  });

  const rateLimitedDiag: DiagLogger = {
    error: (message) => report(message),
    warn: (message) => report(message),
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
  diag.setLogger(rateLimitedDiag, DiagLogLevel.WARN);

  const instrumentations = getNodeAutoInstrumentations({
    // Every request already produces a Fastify log line; a span per static file
    // would swamp Tempo with nothing worth reading.
    '@opentelemetry/instrumentation-fs': { enabled: false },
  });

  const sdk = new NodeSDK({
    serviceName: settings.serviceName,
    traceExporter: exporter,
    instrumentations,
  });
  sdk.start();

  // The line whose ABSENCE detects the --import trap. It has to name the
  // endpoint and the instrumentation count too: "started" alone would not
  // distinguish "patched nothing" from "cannot reach Tempo".
  process.stdout.write(
    `otel: sdk started, endpoint=${settings.endpoint}, instrumentations=${instrumentations.length}\n`,
  );

  const stop = (): void => {
    void sdk.shutdown().catch(() => {
      // Deliberately silent: the process is already on its way out, and a
      // collector that is down must not delay or fail a shutdown.
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
