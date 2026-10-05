import { installCli, removeCli } from '../support/cli-install.js';

/**
 * Install the packed CLI once per Playwright run, for the cross-surface
 * journeys. Env set here reaches every worker; the returned function is the
 * teardown, so the temporary prefix is gone when the run ends.
 */
export default async function globalSetup(): Promise<() => void> {
  const cli = await installCli();
  process.env.E2E_BIFROST_BINARY = cli.binary;
  process.env.E2E_BIFROST_VERSION = cli.version;
  return () => removeCli(cli);
}
