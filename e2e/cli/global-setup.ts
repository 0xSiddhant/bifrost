import type { TestProject } from 'vitest/node';
import { installCli, removeCli, type InstalledCli } from '../support/cli-install.js';

/** Pack and install the CLI once for every `*.e2e.ts` file, and remove it after. */

declare module 'vitest' {
  export interface ProvidedContext {
    bifrostBinary: string;
    bifrostVersion: string;
  }
}

let installed: InstalledCli | null = null;

export async function setup(project: TestProject): Promise<void> {
  installed = await installCli();
  project.provide('bifrostBinary', installed.binary);
  project.provide('bifrostVersion', installed.version);
}

export function teardown(): void {
  if (installed) removeCli(installed);
}
