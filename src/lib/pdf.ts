import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
let lib: PdfJs | null = null;

/** pdf.js is browser-only, so it is imported lazily and never touched during SSR. */
export async function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = await import('pdfjs-dist');
    lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  }
  return lib;
}

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const p = await pdfjs();
  // getDocument transfers the buffer to the worker, so hand it a copy and keep ours in IndexedDB-ready shape.
  return p.getDocument({
    data: new Uint8Array(data.slice(0)),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  }).promise;
}
