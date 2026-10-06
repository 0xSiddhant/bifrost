import { describe, expect, it } from 'vitest';
import { makePdf } from './pdf.js';

describe('makePdf', () => {
  it('opens with the PDF header and points startxref at the xref table', () => {
    const pdf = makePdf(['one', 'two (2)']).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    expect(pdf).toContain('/Count 2');
  });

  it('records each object at its real byte offset', () => {
    const pdf = makePdf(['a']).toString('latin1');
    const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    entries.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});
