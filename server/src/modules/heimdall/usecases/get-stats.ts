import type { FolderUsage, StatsReader, UploadAuditRepository } from '../ports.js';

export interface StatsResult {
  uptimeSeconds: number;
  connectedClients: number;
  uploads: { total: number; today: number };
  disk: FolderUsage[];
  totalBytes: number;
  /** 24 hourly upload counts, oldest first (index 23 = current hour). */
  activity: number[];
}

const HOUR_MS = 60 * 60 * 1000;
const ACTIVITY_HOURS = 24;

/** Server dashboard figures, all computed on request — no polling daemons. */
export class GetStatsUseCase {
  constructor(
    private readonly stats: StatsReader,
    private readonly audit: UploadAuditRepository,
    private readonly connectedClients: () => number,
    private readonly uptimeSeconds: () => number = () => process.uptime(),
    private readonly now: () => number = Date.now,
  ) {}

  execute(): StatsResult {
    const now = this.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const disk = this.stats.diskUsage();
    const totalBytes = disk.reduce((sum, entry) => sum + entry.bytes, 0);

    const total = this.audit.page(1, 0).total;
    const today = this.audit.timestampsSince(startOfDay.getTime()).length;

    const activity = new Array<number>(ACTIVITY_HOURS).fill(0);
    for (const stamp of this.audit.timestampsSince(now - ACTIVITY_HOURS * HOUR_MS)) {
      const hoursAgo = Math.floor((now - stamp) / HOUR_MS);
      const index = ACTIVITY_HOURS - 1 - hoursAgo;
      if (index >= 0 && index < ACTIVITY_HOURS) activity[index] = (activity[index] ?? 0) + 1;
    }

    return {
      uptimeSeconds: Math.floor(this.uptimeSeconds()),
      connectedClients: this.connectedClients(),
      uploads: { total, today },
      disk,
      totalBytes,
      activity,
    };
  }
}
