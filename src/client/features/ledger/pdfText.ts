/// <reference types="vite/client" />
import type { PdfItem } from '../../../shared/import/cardPdf';

const MAX_PAGES = 30;

/**
 * Text runs of a PDF with their positions, read in the browser (the file never leaves the device).
 * pdf.js and its worker are loaded only when a PDF is chosen. Throws on an unreadable or locked PDF.
 */
export async function pdfItems(bytes: Uint8Array): Promise<PdfItem[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // Text only: no fonts or images are rendered.
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, enableXfa: false });
  const doc = await task.promise;
  try {
    const out: PdfItem[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        out.push({ page: p, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, s: it.str, rtl: it.dir === 'rtl' });
      }
    }
    return out;
  } finally {
    void task.destroy();
  }
}
