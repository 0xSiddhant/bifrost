import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDeviceId } from '../../core/deviceId';
import { deviceName, onDevicesChange } from '../../core/devices';
import { formatTimeAgo } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { AlertIcon, GaugeIcon } from '../../core/ui/icons';
import { fetchNimbusConfig, type NimbusConfig, type NimbusResult } from './api';
import {
  formatLatency,
  formatMbps,
  median,
  sparklinePoints,
  spreadPercent,
} from './metrics';
import { BroomBusyError, runSpeedTest, TestCancelled, type TestProgress } from './runTest';
import { useHistory } from './useHistory';
import './nimbus.css';

const PHASE_COPY: Record<TestProgress['phase'], { label: string; hint: string }> = {
  warmup: { label: 'Warming up', hint: 'a short untimed flight so the link is up to speed' },
  ping: { label: 'Measuring latency', hint: 'ten round trips; the median is what counts' },
  down: { label: 'Downloading', hint: 'from the bridge to this device' },
  up: { label: 'Uploading', hint: 'from this device to the bridge' },
  saving: { label: 'Recording', hint: 'filing the reading in this device’s history' },
};

/** The broom on its track: it flies left→right through whichever phase is live. */
function BroomTrack({ progress }: { progress: TestProgress }) {
  const copy = PHASE_COPY[progress.phase];
  return (
    <div className="nimbus-flight" role="status" aria-live="polite">
      <div className="nimbus-track">
        <div className="nimbus-track__fill" style={{ width: `${progress.fraction * 100}%` }} />
        <span
          className="nimbus-broom"
          style={{ left: `${progress.fraction * 100}%` }}
          aria-hidden="true"
        >
          🧹
        </span>
      </div>
      <p className="nimbus-phase">
        <strong>{copy.label}</strong>
        <span className="caption"> · {copy.hint}</span>
      </p>
    </div>
  );
}

/** The live gauge — one enormous number for the phase in flight. */
function PhaseGauge({ progress }: { progress: TestProgress }) {
  const pinging = progress.phase === 'ping' || progress.phase === 'warmup';
  const value = pinging ? progress.latencyMs : progress.liveMbps;
  const text = pinging ? formatLatency(progress.latencyMs) : formatMbps(progress.liveMbps);
  return (
    <div className="nimbus-gauge">
      {/* Before the first reading of a phase there is nothing to show, and an
          em dash at gauge size reads as a broken block — so the placeholder
          gets its own muted, ordinary-sized style. */}
      <span className={`nimbus-gauge__value${value === null ? ' nimbus-gauge__value--idle' : ''}`}>
        {text}
      </span>
      <span className="nimbus-gauge__unit">{pinging ? 'ms' : 'Mbps'}</span>
    </div>
  );
}

function ResultCard({ result, live }: { result: NimbusResult; live?: boolean }) {
  return (
    <div className={`nimbus-result${live ? ' nimbus-result--live' : ''}`}>
      <div className="nimbus-figure">
        <span className="nimbus-figure__label">↓ download</span>
        <span className="nimbus-figure__value">{formatMbps(result.downMbps)}</span>
        <span className="nimbus-figure__unit">Mbps</span>
      </div>
      <div className="nimbus-figure">
        <span className="nimbus-figure__label">↑ upload</span>
        <span className="nimbus-figure__value">{formatMbps(result.upMbps)}</span>
        <span className="nimbus-figure__unit">Mbps</span>
      </div>
      <div className="nimbus-figure">
        <span className="nimbus-figure__label">latency</span>
        <span className="nimbus-figure__value">{formatLatency(result.latencyMs)}</span>
        <span className="nimbus-figure__unit">ms</span>
      </div>
    </div>
  );
}

interface DeviceHistory {
  deviceId: string | null;
  display: string;
  results: NimbusResult[];
  isThisDevice: boolean;
}

/** One row per device: its latest reading, its trend, and how settled it is. */
function HistoryRow({ history }: { history: DeviceHistory }) {
  const newest = history.results[0];
  if (!newest) return null;
  // Oldest → newest for the sparkline; capped so a long history stays legible.
  const series = history.results.slice(0, 20).map((row) => row.downMbps).reverse();
  const points = sparklinePoints(series, 120, 28, 2);
  const spread = spreadPercent(series.slice(-3));
  const typical = median(history.results.map((row) => row.downMbps));

  return (
    <li className="nimbus-history__row">
      <div className="nimbus-history__who">
        <span className="nimbus-history__name">
          {history.display}
          {history.isThisDevice && <span className="badge">this device</span>}
        </span>
        <span className="caption">
          {history.results.length} test{history.results.length === 1 ? '' : 's'} · typical ↓
          {formatMbps(typical)} Mbps
          {spread !== null && ` · last 3 within ${Math.round(spread)}%`}
        </span>
      </div>

      {points ? (
        <svg
          className="nimbus-spark"
          viewBox="0 0 120 28"
          preserveAspectRatio="none"
          role="img"
          aria-label={`download trend for ${history.display}`}
        >
          <polyline points={points} />
        </svg>
      ) : (
        <span className="caption nimbus-spark__empty">one reading so far</span>
      )}

      <div className="nimbus-history__figures">
        <span>↓ {formatMbps(newest.downMbps)}</span>
        <span>↑ {formatMbps(newest.upMbps)}</span>
        <span>{formatLatency(newest.latencyMs)} ms</span>
        <span className="caption">
          {newest.testMb} MB · {formatTimeAgo(newest.createdAt)}
        </span>
      </div>
    </li>
  );
}

/**
 * Nimbus (PLAN-14) — the LAN speed test. Every internet speed test measures the
 * ISP link; this one measures the air between the device in your hand and the
 * Mac serving Bifrost, which is the number that explains why the iPad is slow in
 * the bedroom.
 *
 * Mobile-first on purpose: this tool gets used while walking around the house,
 * so the numbers are huge and the start control is thumb-sized.
 */
export function NimbusPage() {
  const { results, ready, error, add } = useHistory();
  const [config, setConfig] = useState<NimbusConfig | null>(null);
  const [testMb, setTestMb] = useState<number | null>(null);
  const [progress, setProgress] = useState<TestProgress | null>(null);
  const [latest, setLatest] = useState<NimbusResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Device names arrive from presence asynchronously; re-render when they land.
  const [, setNameTick] = useState(0);
  useEffect(() => onDevicesChange(() => setNameTick((tick) => tick + 1)), []);

  useEffect(() => {
    let cancelled = false;
    fetchNimbusConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        // Default to the smallest offered size: a first test should be quick,
        // and 10 MB is plenty to separate "fine" from "why is this so slow".
        setTestMb((current) => current ?? cfg.sizes[0] ?? 10);
      })
      .catch(() => {
        if (!cancelled) setFailure('Could not reach the bridge to read its test settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A test in flight must not be abandoned silently: leaving the page aborts it
  // and hands the guard back, so the next device isn't locked out.
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    if (!config || !testMb || progress) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(null);
    setFailure(null);
    setLatest(null);
    setProgress({
      phase: 'warmup',
      fraction: 0,
      liveMbps: null,
      latencyMs: null,
      downMbps: null,
      upMbps: null,
    });

    try {
      const result = await runSpeedTest({
        testMb,
        pingSamples: config.pingSamples,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setLatest(result);
      add(result);
    } catch (caught) {
      if (caught instanceof BroomBusyError) {
        setBusy('Another broom is flying — a test is already running on this bridge.');
      } else if (!(caught instanceof TestCancelled)) {
        setFailure('The test could not finish. The link may have dropped mid-flight.');
      }
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }, [add, config, progress, testMb]);

  const cancel = () => abort.current?.abort();

  const histories = useMemo<DeviceHistory[]>(() => {
    const mine = getDeviceId();
    const groups = new Map<string, DeviceHistory>();
    for (const result of results) {
      const key = result.deviceId ?? 'unknown';
      let group = groups.get(key);
      if (!group) {
        group = {
          deviceId: result.deviceId,
          display:
            deviceName(result.deviceId) ??
            (result.deviceId === null ? 'unnamed device' : 'departed device'),
          results: [],
          isThisDevice: result.deviceId === mine,
        };
        groups.set(key, group);
      }
      group.results.push(result);
    }
    // This device first — it is the one whose air you are standing in.
    const latestAt = (group: DeviceHistory) => group.results[0]?.createdAt ?? 0;
    return [...groups.values()].sort((a, b) => {
      if (a.isThisDevice !== b.isThisDevice) return a.isThisDevice ? -1 : 1;
      return latestAt(b) - latestAt(a);
    });
  }, [results]);

  const running = progress !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--teal">nimbus · the fastest broom on the bridge</span>
          <h2>Nimbus</h2>
          <p>
            How fast is the air between this device and the bridge? An internet speed test measures
            your ISP; Nimbus measures your Wi-Fi.
          </p>
        </div>
      </div>

      <Card>
        <div className="nimbus-launch">
          <div className="nimbus-sizes" role="group" aria-label="Test size">
            {(config?.sizes ?? []).map((size) => (
              <button
                key={size}
                type="button"
                className={`chip${size === testMb ? ' chip--on' : ''}`}
                aria-pressed={size === testMb}
                disabled={running}
                onClick={() => setTestMb(size)}
              >
                {size} MB
              </button>
            ))}
          </div>

          {running ? (
            <>
              <PhaseGauge progress={progress} />
              <BroomTrack progress={progress} />
              <Button variant="ghost" onClick={cancel} className="nimbus-cta">
                Cancel
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void start()}
              disabled={!config || !testMb}
              className="nimbus-cta"
            >
              🧹 Fly
            </Button>
          )}

          {busy && (
            <p className="nimbus-notice" role="status">
              <AlertIcon size={16} /> {busy} Wait for it to land and try again.
            </p>
          )}
          {failure && (
            <p className="nimbus-notice" role="alert">
              <AlertIcon size={16} /> {failure}
            </p>
          )}
        </div>

        {latest && (
          <>
            <ResultCard result={latest} live />
            <p className="caption nimbus-note">
              {latest.testMb} MB each way · recorded {formatTimeAgo(latest.createdAt)}
            </p>
          </>
        )}

        <p className="caption nimbus-note">
          Approximate by design. Latency is the median of{' '}
          {config ? config.pingSamples : 10} round trips; throughput is timed over{' '}
          {testMb ?? '—'} MB of incompressible data, sent uncompressed and thrown away on arrival.
          One test runs at a time — numbers measured while another device is transferring would be
          meaningless. Wi-Fi varies with the room, the hour, and the microwave.
        </p>
      </Card>

      <h3 className="nimbus-heading">History</h3>
      {!ready && <p className="caption">Reading the flight log…</p>}
      {ready && error && <p className="caption">The flight log could not be read.</p>}
      {ready && !error && histories.length === 0 && (
        <EmptyState
          icon={<GaugeIcon size={28} />}
          title="No flights logged yet"
          hint="Run a test and this device gets its own trend line."
        />
      )}
      {histories.length > 0 && (
        <ul className="nimbus-history">
          {histories.map((history) => (
            <HistoryRow key={history.deviceId ?? 'unknown'} history={history} />
          ))}
        </ul>
      )}
    </>
  );
}
