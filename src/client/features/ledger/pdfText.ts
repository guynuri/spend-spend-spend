/// <reference types="vite/client" />
import type { PdfItem } from '../../../shared/import/cardPdf';

const MAX_PAGES = 30;

type PdfJs = typeof import('pdfjs-dist');

/** pdf.js builds, tried in order: the modern one (current Safari / Chrome), then the legacy one (polyfilled). */
const BUILDS: { name: string; load: () => Promise<[PdfJs, { default: string }]> }[] = [
  { name: 'modern', load: () => Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]) },
  { name: 'legacy', load: () => Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>, import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]) },
];

/** Every build failed; `detail` says how (shown with the error so a failure on one device can be traced). */
export class PdfReadError extends Error {
  constructor(public detail: string) {
    super(detail);
    this.name = 'PdfReadError';
  }
}

/** Problems with the file itself: every build reports the same, so the next build is not tried. */
const FILE_ERRORS = new Set(['PasswordException', 'InvalidPDFException']);

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);

type TextItem = Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>['getTextContent']>>['items'][number];

/**
 * A page's text items. page.getTextContent() loops over a ReadableStream with `for await`, which
 * Safari (iPhone) doesn't support ("undefined is not a function"), so the stream is read with its
 * reader instead.
 */
async function textItems(page: { streamTextContent: () => ReadableStream }): Promise<TextItem[]> {
  const reader = (page.streamTextContent() as ReadableStream<{ items: TextItem[] }>).getReader();
  const items: TextItem[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return items;
      items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }
}

async function extract(pdfjs: PdfJs, workerSrc: string, bytes: Uint8Array): Promise<PdfItem[]> {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  // Text only: no fonts or images are rendered.
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, enableXfa: false });
  try {
    const doc = await task.promise;
    const out: PdfItem[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      for (const it of await textItems(page)) {
        if (!('str' in it) || !it.str.trim()) continue;
        out.push({ page: p, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, s: it.str, rtl: it.dir === 'rtl' });
      }
    }
    return out;
  } finally {
    task.destroy().catch(() => {});
  }
}

/**
 * Text runs of a PDF with their positions, read in the browser (the file never leaves the device).
 * pdf.js and its worker are loaded only when a PDF is chosen. Throws PdfReadError when no build can read it.
 */
export async function pdfItems(bytes: Uint8Array): Promise<PdfItem[]> {
  const failures: string[] = [];
  for (const b of BUILDS) {
    // A build that fell back to running its worker on the main thread leaves its worker code on
    // globalThis.pdfjsWorker, which the next build would pick up instead of its own.
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
    try {
      const [pdfjs, worker] = await b.load();
      // pdf.js hands the buffer to its worker (detaching it): each attempt gets its own copy.
      return await extract(pdfjs, worker.default, bytes.slice());
    } catch (e) {
      console.error(`PDF read failed (${b.name} build)`, e);
      failures.push(`${b.name}: ${describe(e)}`);
      if (e instanceof Error && FILE_ERRORS.has(e.name)) break;
    }
  }
  throw new PdfReadError(failures.join(' | '));
}
