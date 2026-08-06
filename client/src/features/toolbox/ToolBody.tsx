import { Base64Tool } from './tools/Base64Tool';
import { EpochTool } from './tools/EpochTool';
import { QrTool } from './tools/QrTool';
import { UuidTool } from './tools/UuidTool';

/**
 * The whole tool set in **one** lazy chunk (PLAN-18), loaded when the first
 * panel opens. Not one chunk per tool as PLAN-99 suggested: every body is a few
 * kB of pure functions, so per-tool splitting would cost a dozen round trips
 * for less than one round trip's worth of bytes. A tool that ever pulls a
 * dependency over ~20 kB earns its own chunk at that point.
 */
export function ToolBody({ toolId }: { toolId: string }) {
  switch (toolId) {
    case 'qr':
      return <QrTool />;
    case 'base64':
      return <Base64Tool />;
    case 'uuid':
      return <UuidTool />;
    case 'epoch':
      return <EpochTool />;
    default:
      // Unreachable: the caller only opens ids that are in the registry, and
      // an unknown :toolId is redirected to the hub before we get here.
      return null;
  }
}
