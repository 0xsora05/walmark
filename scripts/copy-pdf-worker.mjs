// Copies the pdf.js worker + CMaps + standard fonts into /public/pdfjs so the
// reader can load them same-origin (no CDN, works offline / as a PWA).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'pdfjs-dist');

if (!existsSync(pkg)) {
  console.log('[walmark] pdfjs-dist not installed yet, skipping asset copy');
  process.exit(0);
}

const out = join(root, 'public', 'pdfjs');
mkdirSync(out, { recursive: true });
cpSync(join(pkg, 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts']) {
  if (existsSync(join(pkg, dir))) cpSync(join(pkg, dir), join(out, dir), { recursive: true });
}
console.log('[walmark] pdf.js assets copied to public/pdfjs');
