import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { listResults, type NimbusResult } from './api';

/**
 * The recorded history, kept live. One fetch, then `nimbus.completed` deltas —
 * so a test run on the phone in the bedroom appears on the laptop's page while
 * you walk back, which is half the point of recording them at all.
 */
export function useHistory(): {
  results: NimbusResult[];
  ready: boolean;
  error: boolean;
  add: (result: NimbusResult) => void;
} {
  const [results, setResults] = useState<NimbusResult[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Newest first, and never twice: this page saves its own result *and* hears
  // the SSE echo of it.
  const add = (result: NimbusResult) =>
    setResults((rows) =>
      rows.some((row) => row.id === result.id)
        ? rows
        : [result, ...rows].sort((a, b) => b.createdAt - a.createdAt),
    );

  useEffect(() => {
    let cancelled = false;

    listResults()
      .then((rows) => {
        if (cancelled) return;
        setResults(rows);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setReady(true);
      });

    const off = bifrostEvents.on('nimbus.completed', (payload) => {
      const result = (payload as { result?: NimbusResult }).result;
      if (result) add(result);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return { results, ready, error, add };
}
