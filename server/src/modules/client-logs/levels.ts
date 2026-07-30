import { LOG_LEVELS, type LogLevel } from '../../core/config/index.js';

/**
 * Is `level` at or above the configured floor?
 *
 * The client filters on the same floor before sending, so this is the second
 * of two gates — and the one that holds when the first is bypassed. A stale
 * tab that cached an older, lower `CLIENT_LOG_LEVEL`, or anything on the LAN
 * posting by hand, would otherwise write `trace` spam straight into the
 * archive through an endpoint that has no session behind it.
 */
export function atOrAboveFloor(level: LogLevel, floor: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(floor);
}
