import type { ReactNode } from 'react';
import type { PanelLayout } from '../../core/ui/ExpandingGrid';
import { ClockIcon, CodeIcon, GaugeIcon, KeyIcon, QrIcon, WandIcon } from '../../core/ui/icons';

export interface ToolCard {
  id: string;
  title: string;
  /** One line under the title. Tool cards are compact — no paragraph. */
  hint: string;
  icon: ReactNode;
  /**
   * Capability module that gates the card. The tools are `toolbox`; Nimbus and
   * Portkey keep their own, so dropping either module drops only its card.
   */
  module: string;
  /** Set for a card that navigates to its own page instead of expanding. */
  to?: string;
  /** How an expanding tool uses the full-width panel. */
  layout?: PanelLayout;
  /**
   * Environment gate. An unsupported tool is not rendered at all and a deep
   * link to it falls back to the hub — better than a card that throws when
   * tapped. Its only user today is SHA-256 (`crypto.subtle` is
   * secure-context-only, so it is absent on every device except the host Mac
   * at localhost).
   */
  supported?: () => boolean;
}

/**
 * The Diagon Alley toolbox (PLAN-18). Order is meaningful: card colour follows
 * **position** in this array via cardToneClass, so reordering recolours and
 * nothing hardcodes a hue. The two `to` cards navigate as they always did —
 * they own real state and a server module, so they keep their own page.
 */
export const TOOLS: ToolCard[] = [
  {
    id: 'nimbus',
    title: 'Nimbus',
    hint: 'How fast is the air between here and the bridge',
    icon: <GaugeIcon size={22} />,
    module: 'nimbus',
    to: '/nimbus',
  },
  {
    id: 'portkey',
    title: 'Portkey',
    hint: 'Short go-links for the whole network',
    icon: <WandIcon size={22} />,
    module: 'portkey',
    to: '/portkey',
  },
  {
    id: 'qr',
    title: 'Make a QR',
    hint: 'Text or a URL → a scannable code',
    icon: <QrIcon size={22} />,
    module: 'toolbox',
    layout: 'split',
  },
  {
    id: 'base64',
    title: 'Base64',
    hint: 'Encode and decode, standard or URL-safe',
    icon: <CodeIcon size={22} />,
    module: 'toolbox',
    layout: 'full',
  },
  {
    id: 'uuid',
    title: 'UUID',
    hint: 'v4 and v7, one or a hundred',
    icon: <KeyIcon size={22} />,
    module: 'toolbox',
    layout: 'split',
  },
  {
    id: 'epoch',
    title: 'Epoch',
    hint: 'Unix time ⇄ human time, both ways',
    icon: <ClockIcon size={22} />,
    module: 'toolbox',
    layout: 'split',
  },
];

/**
 * `supported()` is answered once per session and remembered: it asks about the
 * browser's own capabilities (secure context, Web Crypto), which cannot change
 * while the page is open, and a card that appeared and disappeared between two
 * renders would be worse than either answer.
 */
const supportAnswers = new Map<string, boolean>();

export function isSupported(tool: ToolCard): boolean {
  if (!tool.supported) return true;
  const remembered = supportAnswers.get(tool.id);
  if (remembered !== undefined) return remembered;
  let answer: boolean;
  try {
    answer = tool.supported();
  } catch {
    // A probe that throws is a "no". Deliberately silent: this is the gate
    // doing its job on an environment that lacks the API, not a failure.
    answer = false;
  }
  supportAnswers.set(tool.id, answer);
  return answer;
}

/** The cards this browser, on this deploy profile, should actually see. */
export function availableTools(
  tools: ToolCard[],
  hasModule: (module: string) => boolean,
): ToolCard[] {
  return tools.filter((tool) => hasModule(tool.module) && isSupported(tool));
}

/** Test seam: forget the remembered `supported()` answers. */
export function resetSupportCache(): void {
  supportAnswers.clear();
}
