import type { Download } from '@playwright/test';

/** The bytes of a browser download, read without touching a fixed path. */
export async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * The file names inside a zip, read from its central directory. A zip stores
 * names uncompressed there, so checking an archive's contents needs no unzip
 * dependency; the `PK\x01\x02` record is the central-directory file header.
 */
export function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (
    let offset = zip.indexOf('PK\x01\x02');
    offset !== -1;
    offset = zip.indexOf('PK\x01\x02', offset + 4)
  ) {
    const nameLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
  }
  return names;
}

export function textFile(name: string, text: string, mimeType = 'text/plain') {
  return { name, mimeType, buffer: Buffer.from(text, 'utf8') };
}
