/** A device as stored in the `devices` table. */
export interface KnownDevice {
  deviceId: string;
  name: string | null;
  charName: string | null;
  label: string | null;
  firstSeen: number;
  lastSeen: number;
}

export interface DeviceRepository {
  /**
   * Record a sighting: insert the device (with its character alias) or bump its
   * label + lastSeen. The alias is only written on insert — never overwritten.
   */
  upsertSeen(deviceId: string, label: string, charName: string, now: number): void;
  /** Set/clear the friendly name; returns whether the device exists. */
  rename(deviceId: string, name: string | null): boolean;
  all(): KnownDevice[];
}
