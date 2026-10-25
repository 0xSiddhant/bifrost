import { isLoopbackHost, loadDotenv, loadWebConfig, type WebConfig } from './config.js';
import { createWebLogger, logsDirProblem } from './logger.js';
import { advertiserDecision, mdnsDecision, type MdnsDecision } from './main.js';
import { advertiseMdns } from './mdns.js';

/**
 * A process that only answers for `<MDNS_NAME>.local`, with PLAN-36's
 * hardened responder (error guard, network-change rebuild). Two callers:
 *
 * - `host` (`web/dist/advertise.js`, PLAN-39): `bifrost-mdns`, run natively
 *   beside the API when the web host is in a container that cannot multicast
 *   onto the LAN (`MDNS_ADVERTISER=host`, Docker Desktop on the Mac);
 * - `dev` (`npm run dev`): there is no web host, Vite serves `PORT`.
 *
 * Either way it advertises this machine's own addresses on `PORT`, which is
 * where the page actually answers.
 */
export type AdvertiserKind = 'host' | 'dev';

export function decisionFor(kind: AdvertiserKind, config: WebConfig): MdnsDecision {
  if (kind === 'host') return advertiserDecision(config);
  // Dev: Vite listens on every interface unless told otherwise, so only an
  // explicit loopback WEB_HOST (or MDNS_ADVERTISER=off) turns the name off.
  return mdnsDecision({
    profile: config.profile,
    host: isLoopbackHost(config.host) ? config.host : '0.0.0.0',
    mdnsAdvertiser: config.mdnsAdvertiser === 'off' ? 'off' : 'web',
  });
}

export function runAdvertiser(kind: AdvertiserKind): void {
  loadDotenv();
  const config = loadWebConfig();
  const problem = logsDirProblem(config.logsDir);
  if (problem) {
    process.stderr.write(`mdns advertiser: ${problem}\n`);
    process.exit(1);
  }
  const log = createWebLogger({
    level: config.logLevel,
    logsDir: config.logsDir,
    retainFiles: config.logRetentionFiles,
    pretty: kind === 'dev',
  });
  const decision = decisionFor(kind, config);
  if (!decision.advertise) {
    log.info(
      { reason: decision.reason },
      `mdns advertiser (${kind}): not advertising — ${decision.reason}`,
    );
    // `host` under a process manager: stay up rather than exit, or PM2 and
    // launchd would restart it in a loop. A changed .env takes a restart.
    if (kind === 'host') setInterval(() => {}, 1 << 30);
    return;
  }
  const mdns = advertiseMdns(config.mdnsName, config.port, log);
  log.info(`mdns advertiser (${kind}): http://${config.mdnsName}.local:${config.port}`);
  const stop = () => void mdns.stop().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
