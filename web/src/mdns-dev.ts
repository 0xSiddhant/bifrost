import { isLoopbackHost, loadDotenv, loadWebConfig } from './config.js';
import { createWebLogger } from './logger.js';
import { advertiseMdns } from './mdns.js';
import { mdnsDecision } from './main.js';

/**
 * `npm run dev` has no web host (Vite serves the client on PORT), so this
 * advertiser-only process keeps `bifrost.local` working in development, as it
 * did when the API server advertised (PLAN-36). It answers for the name and
 * nothing else.
 */
loadDotenv();
const config = loadWebConfig();
const log = createWebLogger({
  level: config.logLevel,
  logsDir: config.logsDir,
  retainFiles: config.logRetentionFiles,
  pretty: true,
});
// Vite listens on every interface in dev unless told otherwise, so only an
// explicit loopback WEB_HOST turns the name off here.
const decision = mdnsDecision({
  profile: config.profile,
  host: isLoopbackHost(config.host) ? config.host : '0.0.0.0',
});
if (!decision.advertise) {
  log.info(`mdns-dev: not advertising — ${decision.reason}`);
} else {
  const mdns = advertiseMdns(config.mdnsName, config.port, log);
  log.info(`mdns-dev: http://${config.mdnsName}.local:${config.port} (vite)`);
  const stop = () => void mdns.stop().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
