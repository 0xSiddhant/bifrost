import zlib from 'node:zlib';

/**
 * Just enough of the zip format to prove an archive is whole (PLAN-33): the
 * end-of-central-directory record, every central entry, and each entry's data
 * found through its local header, inflated and CRC-checked. A truncated or
 * corrupt stream fails here, which "starts with PK" never would.
 */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZip(zip: Buffer): ZipEntry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central entry at ${at}`);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    entries.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
