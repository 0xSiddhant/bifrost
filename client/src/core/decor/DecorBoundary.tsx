import { Component, type ReactNode } from 'react';
import { isChunkLoadError } from '../chunkError';
import { log } from '../log';
import type { DecorSlotName } from './types';

interface DecorBoundaryProps {
  slot: DecorSlotName;
  children: ReactNode;
  /** Told once that this slot's decorations are gone (a failed chunk or a bug). */
  onError: () => void;
}

interface DecorBoundaryState {
  failed: boolean;
}

/**
 * Contains whatever goes wrong inside a slot's decorations: they render
 * nothing and the page carries on. Unlike `ChunkBoundary`, which re-throws
 * render bugs to the app-wide boundary, this catches every error, because a
 * decoration is never worth the page: a season is a plug-in, and a bug in one
 * must cost only its decorations.
 *
 * A chunk that failed to load has already been reported once for all three
 * slots (`loadSeason`); any other error is a bug in the season's code and is
 * logged here, once per slot. Remounting the slot (the theme or a switch
 * turning decorations off and on) tries again. Still a class component:
 * `componentDidCatch` has no hook equivalent.
 */
export class DecorBoundary extends Component<DecorBoundaryProps, DecorBoundaryState> {
  override state: DecorBoundaryState = { failed: false };

  /** React may deliver one error to `componentDidCatch` twice (see ChunkBoundary). */
  private reported = false;

  static getDerivedStateFromError(): DecorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    if (this.reported) return;
    this.reported = true;
    if (!isChunkLoadError(error)) {
      log.reportError(
        `decor: a decoration in the ${this.props.slot} slot failed and was removed`,
        error,
        {
          module: 'decor',
        },
      );
    }
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
