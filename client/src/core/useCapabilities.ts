import { useEffect, useState } from 'react';
import { fetchCapabilities, type Capabilities } from './api';

export interface CapabilitiesState {
  capabilities: Capabilities | null;
  error: string | null;
}

/** The nav renders from this — one client build serves every deploy profile. */
export function useCapabilities(): CapabilitiesState {
  const [state, setState] = useState<CapabilitiesState>({ capabilities: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchCapabilities()
      .then((capabilities) => {
        if (!cancelled) setState({ capabilities, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ capabilities: null, error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
