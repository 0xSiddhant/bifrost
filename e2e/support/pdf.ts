/**
 * A small, valid PDF built in memory — one page per line of `pages`, each
 * showing that line in Helvetica — so the Saga journey can drop a real PDF
 * without committing a binary fixture. The cross-reference table carries real
 * byte offsets, so a strict parser (pdf.js) reads it without repair.
 */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  // Object numbers start at 1, which is exactly the length after the push.
  const add = (body: string) => objects.push(body);

  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kidsPlaceholder = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const text of pages) {
    const escaped = text.replace(/[\\()]/g, (char) => `\\${char}`);
    const stream = `BT /F1 36 Tf 72 400 Td (${escaped}) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[kidsPlaceholder - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
