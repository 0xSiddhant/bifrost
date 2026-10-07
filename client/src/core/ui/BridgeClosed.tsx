import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onBridgeClosed, type BridgeClosedRequest } from '../bridge';
import { log } from '../log';
import { bifrostEvents } from '../sse';
import { Button } from './Button';
import './bridge-closed.css';

/** A vanished host never refuses, so "Try again" needs its own patience limit. */
const PROBE_TIMEOUT_MS = 3_000;

/** Heimdall at the gate, in the theme's own colours. Decorative. */
function GateMark() {
  return (
    <svg className="bridge-closed__mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="bridge-closed__arch" d="M6 46 C 18 10, 46 10, 58 46" />
      <path className="bridge-closed__gate" d="M24 46 V30 h16 v16 M32 30 v16" />
      <circle className="bridge-closed__warden" cx="32" cy="22" r="3.5" />
      <path className="bridge-closed__ground" d="M4 50 H60" />
    </svg>
  );
}

const TITLE = 'The Bifröst is closed';
const TEXT = "This needs your Bifrost hub, and the bridge to it isn't open from here.";

interface SheetProps {
  request: BridgeClosedRequest;
  onClose: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}

function Sheet({ request, onClose, onRetry, retrying }: SheetProps) {
  return (
    <div className="bridge-closed" role="alertdialog" aria-labelledby="bridge-closed-title" aria-describedby="bridge-closed-text">
      <GateMark />
      <div className="bridge-closed__body">
        <h3 id="bridge-closed-title">{TITLE}</h3>
        <p id="bridge-closed-text">{TEXT}</p>
        <div className="bridge-closed__actions">
          {request.download && (
            <Button
              variant="primary"
              onClick={() => {
                request.download?.();
                onClose();
              }}
            >
              Download instead
            </Button>
          )}
          {/* On the standalone site there is no hub to try again against. */}
          {request.reason === 'unreachable' && onRetry && (
            <Button variant={request.download ? 'ghost' : 'primary'} onClick={onRetry} disabled={retrying}>
              {retrying ? 'Trying…' : 'Try again'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Okay
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The one sheet behind every "needs the hub" moment (PLAN-35). Mounted once,
 * in the shell. Repeated failures while it is open merge into it rather than
 * stacking, and a later request that brings a "Download instead" adds it to
 * the sheet already showing.
 *
 * In the hub build it closes itself once the live stream reports `open`
 * again, since that is the hub answering. "Try again" asks the health route
 * directly, for the case where the stream has not noticed yet.
 */
export function BridgeClosedHost() {
  const [request, setRequest] = useState<BridgeClosedRequest | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(
    () =>
      onBridgeClosed((next) => {
        setRequest((current) =>
          current
            ? { reason: current.reason, download: next.download ?? current.download }
            : next,
        );
      }),
    [],
  );

  useEffect(() => {
    if (!__HUB__) return;
    return bifrostEvents.onStatus((status) => {
      if (status === 'open') setRequest(null);
    });
  }, []);

  const close = useCallback(() => setRequest(null), []);

  const retry = useCallback(async () => {
    // Only an unreachable *hub* offers this; the standalone build has no route to ask.
    if (!__HUB__) return;
    setRetrying(true);
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (response.ok) setRequest(null);
    } catch (error) {
      // Still down: the sheet stays, which is itself the answer. Logged at
      // debug, because the failure was already shown, not hidden.
      log.debug(`bridge still closed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRetrying(false);
    }
  }, []);

  if (!request) return null;
  return (
    <div className="bridge-closed-scrim" onClick={close}>
      <div onClick={(event) => event.stopPropagation()}>
        <Sheet request={request} onClose={close} onRetry={() => void retry()} retrying={retrying} />
      </div>
    </div>
  );
}

/**
 * The page body for a hub-only page on the standalone site: a deep link to
 * `/hermes`, or a server path (`/go/…`, `/api/…`) the container's fallback
 * hands to the app. The sheet, in place of a 404.
 */
export function BridgeClosedPage() {
  const navigate = useNavigate();
  return (
    <div className="bridge-closed-page">
      <Sheet request={{ reason: 'standalone' }} onClose={() => navigate('/')} />
    </div>
  );
}
