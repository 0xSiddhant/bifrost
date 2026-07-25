/**
 * The measurement arithmetic, kept pure and away from the network so the
 * numbers on screen can be unit-tested.
 *
 * Note the two units, deliberately mixed the way networking itself mixes them:
 * payload **sizes** are binary megabytes (1 MB = 1 MiB, matching the server's
 * stream), while **throughput** is decimal megabits per second — a 100 Mbps link
 * means 100,000,000 bits, not 2^20-based ones.
 */

/**
 * Median, not mean: one Wi-Fi retry inside a ten-sample run adds tens of
 * milliseconds to an average and describes a round trip that never happened.
 * Returns null for an empty sample so callers show "—" rather than a fake 0.
 */
export function median(values: readonly number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const middle = Math.floor(usable.length / 2);
  const upper = usable[middle] ?? 0;
  return usable.length % 2 === 1 ? upper : ((usable[middle - 1] ?? 0) + upper) / 2;
}

/** Megabits per second from a byte count and a duration. */
export function mbps(bytes: number, ms: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(ms) || ms <= 0 || bytes <= 0) return 0;
  return (bytes * 8) / (ms / 1000) / 1_000_000;
}

/**
 * Three significant figures, which is the most a Wi-Fi reading can honestly
 * claim: 312, 45.6, 4.32, 0.87.
 */
export function formatMbps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  return ms >= 10 ? String(Math.round(ms)) : ms.toFixed(1);
}

/** MB moved so far / MB expected, clamped — drives the broom's position. */
export function fraction(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

/**
 * Points for a `<polyline>` sparkline, oldest reading on the left. Scaled to the
 * series' own maximum (from zero, so a flat line of 300 Mbps doesn't look like a
 * flat line of 3), and null below two points because one dot is not a trend.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  padding = 1,
): string | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return null;

  const max = Math.max(...usable);
  const span = max > 0 ? max : 1;
  const usableHeight = height - padding * 2;
  const step = (width - padding * 2) / (usable.length - 1);

  return usable
    .map((value, index) => {
      const x = padding + index * step;
      const y = padding + usableHeight * (1 - value / span);
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Spread of a series as a percentage of its mean — acceptance criterion 1 asks
 * for three consecutive runs within ~15%, so the page can show whether the
 * readings are actually settled instead of leaving the owner to eyeball it.
 */
export function spreadPercent(values: readonly number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) return null;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  if (mean <= 0) return null;
  return ((Math.max(...usable) - Math.min(...usable)) / mean) * 100;
}
