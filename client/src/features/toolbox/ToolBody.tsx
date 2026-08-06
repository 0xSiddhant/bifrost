import { Base64Tool } from './tools/Base64Tool';
import { BytesTool } from './tools/BytesTool';
import { CaseTool } from './tools/CaseTool';
import { CidrTool } from './tools/CidrTool';
import { CronTool } from './tools/CronTool';
import { EpochTool } from './tools/EpochTool';
import { HashTool } from './tools/HashTool';
import { IrisTool } from './tools/IrisTool';
import { JwtTool } from './tools/JwtTool';
import { QrTool } from './tools/QrTool';
import { SecretTool } from './tools/SecretTool';
import { UrlTool } from './tools/UrlTool';
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
    case 'url':
      return <UrlTool />;
    case 'bytes':
      return <BytesTool />;
    case 'jwt':
      return <JwtTool />;
    case 'iris':
      return <IrisTool />;
    case 'cidr':
      return <CidrTool />;
    case 'case':
      return <CaseTool />;
    case 'secret':
      return <SecretTool />;
    case 'cron':
      return <CronTool />;
    case 'hash':
      return <HashTool />;
    default:
      // Unreachable: the caller only opens ids that are in the registry, and
      // an unknown :toolId is redirected to the hub before we get here.
      return null;
  }
}
