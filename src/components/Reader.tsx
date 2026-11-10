'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import ConfirmSheet from './ConfirmSheet';
import { IconChevronLeft, IconChevronRight, IconCircle, IconMinus, IconPlus } from './icons';
import { analyzeStroke, centroid, pointInPolygon, type Pt } from '@/lib/circle';
import { getFile } from '@/lib/db';
import { setHighlight } from '@/lib/highlight';
import { loadPdf, pdfjs } from '@/lib/pdf';
import {
  buildTextIndex,
  candidateFromWords,
  collectWords,
  findHighlightRanges,
  rangeFromOffsets,
  selectionToCandidate,
  type Candidate,
  type TextIndex,
} from '@/lib/text';
import type { DocRecord, MemoryRecord, Settings } from '@/lib/types';

interface Props {
  doc: DocRecord;
  memories: MemoryRecord[];
  initialPage: number;
  settings: Settings;
  onPage: (page: number) => void;
  onSave: (req: { word: string; context: string; note?: string; page: number }) => Promise<void>;
}

type Pending = Candidate & { source: 'select' | 'circle' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function Reader({ doc, memories, initialPage, settings, onPage, onSave }: Props) {
  const [page, setPage] = useState(() => clamp(initialPage, 1, doc.numPages));
  const [zoom, setZoom] = useState(1);
  const [circle, setCircle] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [rendered, setRendered] = useState(0);
  const [pdfReady, setPdfReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const idxRef = useRef<TextIndex | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pointsRef = useRef<Pt[]>([]);
  const hintTimer = useRef<number | undefined>(undefined);
  const fadeTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2600);
  }, []);

  /* ---------- sizing ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPageSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(pageSize.w * dpr));
    c.height = Math.max(1, Math.floor(pageSize.h * dpr));
    c.style.width = `${pageSize.w}px`;
    c.style.height = `${pageSize.h}px`;
  }, [pageSize]);

  /* ---------- PDF loading + page rendering ---------- */
  useEffect(() => {
    if (doc.kind !== 'pdf') return;
    let dead = false;
    let pdf: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const data = await getFile(doc.id);
        if (!data) throw new Error('The PDF file is missing from this browser.');
        pdf = await loadPdf(data);
        if (dead) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPdfReady(true);
      } catch (e) {
        if (!dead) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      pdfRef.current = null;
      void pdf?.destroy();
    };
  }, [doc.id, doc.kind]);

  useEffect(() => {
    if (doc.kind !== 'pdf' || !pdfReady || !width) return;
    let dead = false;
    let task: RenderTask | null = null;
    let layer: { cancel: () => void } | null = null;
    idxRef.current = null;

    (async () => {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      const textEl = textRef.current;
      if (!pdf || !canvas || !textEl) return;
      const p = await pdf.getPage(page);
      if (dead) return;
      const base = p.getViewport({ scale: 1 });
      const scale = (Math.min(width, 920) / base.width) * zoom;
      const vp = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;

      textEl.replaceChildren();
      textEl.style.width = `${Math.floor(vp.width)}px`;
      textEl.style.height = `${Math.floor(vp.height)}px`;
      textEl.style.setProperty('--scale-factor', String(scale));
      textEl.style.setProperty('--total-scale-factor', String(scale));

      task = p.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      const lib = await pdfjs();
      const tl = new lib.TextLayer({ textContentSource: p.streamTextContent(), container: textEl, viewport: vp });
      layer = tl;
      await Promise.all([task.promise, tl.render()]);
      if (dead) return;
      idxRef.current = buildTextIndex(textEl);
      setRendered((n) => n + 1);
    })().catch((e: unknown) => {
      const name = (e as { name?: string })?.name;
      if (!dead && name !== 'RenderingCancelledException' && name !== 'AbortException') {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      dead = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc.kind, pdfReady, page, zoom, width]);

  /* ---------- text documents ---------- */
  useEffect(() => {
    if (doc.kind !== 'text') return;
    const el = textRef.current;
    if (!el) return;
    idxRef.current = buildTextIndex(el);
    setRendered((n) => n + 1);
  }, [doc.kind, page, doc.id]);

  /* ---------- highlights ---------- */
  useEffect(() => {
    const idx = idxRef.current;
    if (!idx) return;
    const mine = memories.filter((m) => m.docId === doc.id && m.page === page);
    setHighlight('wm-saved', findHighlightRanges(idx, mine));
  }, [memories, page, rendered, doc.id]);

  useEffect(() => {
    const idx = idxRef.current;
    if (!idx || !pending) {
      setHighlight('wm-pending', []);
      return;
    }
    const r = rangeFromOffsets(idx, pending.start, pending.end);
    setHighlight('wm-pending', r ? [r] : []);
  }, [pending, rendered]);

  useEffect(
    () => () => {
      setHighlight('wm-saved', []);
      setHighlight('wm-pending', []);
      window.clearTimeout(hintTimer.current);
      window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  /* ---------- native text selection (long-press on touch, drag with a mouse) ---------- */
  useEffect(() => {
    if (circle) return;
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const root = textRef.current;
        const idx = idxRef.current;
        if (!root || !idx) return;
        const res = selectionToCandidate(root, idx);
        if (!res) return;
        if ('tooLong' in res) {
          flash('Select a shorter piece, up to 12 words');
          return;
        }
        const c = res.candidate;
        setPending((prev) => (prev && prev.start === c.start && prev.end === c.end ? prev : { ...c, source: 'select' }));
      }, 450);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.clearTimeout(timer);
    };
  }, [circle, flash]);

  /* ---------- circle gesture ---------- */
  const clearOverlay = useCallback(() => {
    const c = overlayRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }, []);

  const drawStroke = useCallback((pts: Pt[]) => {
    const c = overlayRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const rect = c.getBoundingClientRect();
    const dpr = c.width / Math.max(1, rect.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--stroke').trim() || '#14b8a6';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, []);

  const finishCircle = useCallback(
    (pts: Pt[]) => {
      window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(clearOverlay, 650);
      const verdict = analyzeStroke(pts);
      if (!verdict.ok) {
        flash(verdict.reason === 'open' ? 'Close the loop: end near where you started' : 'Draw a bigger circle around the word');
        return;
      }
      const idx = idxRef.current;
      if (!idx) return;
      const words = collectWords(idx);
      let inside = words.filter((w) => pointInPolygon({ x: w.cx, y: w.cy }, pts));
      if (!inside.length) {
        // a tight loop can miss the word's centre; accept the nearest word to the loop's middle
        const c = centroid(pts);
        let best: { w: (typeof words)[number]; d: number } | null = null;
        for (const w of words) {
          const d = Math.hypot(w.cx - c.x, w.cy - c.y);
          if (!best || d < best.d) best = { w, d };
        }
        if (best && best.d < 36) inside = [best.w];
      }
      if (!inside.length) {
        flash('No word inside that circle, try again');
        return;
      }
      const cand = candidateFromWords(idx, inside);
      if (!cand) {
        flash('Circle fewer words, up to 12');
        return;
      }
      setPending({ ...cand, source: 'circle' });
    },
    [clearOverlay, flash],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    window.clearTimeout(fadeTimer.current);
    pointsRef.current = [{ x: e.clientX, y: e.clientY }];
    clearOverlay();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pts = pointsRef.current;
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    if (Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2) return;
    pts.push({ x: e.clientX, y: e.clientY });
    drawStroke(pts);
  };
  const onPointerUp = () => {
    const pts = pointsRef.current;
    pointsRef.current = [];
    if (pts.length) finishCircle(pts);
  };

  /* ---------- navigation ---------- */
  const goto = useCallback(
    (p: number) => {
      const next = clamp(p, 1, doc.numPages);
      setPage(next);
      setPending(null);
      window.getSelection()?.removeAllRanges();
      wrapRef.current?.scrollTo({ top: 0 });
      onPage(next);
    },
    [doc.numPages, onPage],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') goto(page + 1);
      if (e.key === 'ArrowLeft') goto(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goto, page]);

  /* ---------- saving ---------- */
  const confirm = async (note: string) => {
    if (!pending) return;
    setSaving(true);
    try {
      await onSave({ word: pending.word, context: pending.context, note, page });
    } finally {
      setSaving(false);
      setPending(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const cancel = () => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const paragraphs = doc.kind === 'text' ? (doc.pages?.[page - 1] ?? '').split(/\n{2,}/) : [];
  const backendLabel =
    settings.backend === 'memwal' ? 'Walrus Memory (MemWal)' : settings.backend === 'sui' ? `Sui + Walrus · ${settings.encrypt ? 'encrypted' : 'public'}` : settings.encrypt ? 'Walrus · encrypted' : 'Walrus · public';

  return (
    <section className="reader" data-testid="reader">
      <div className="reader-bar">
        <h1 className="reader-title" title={doc.title}>
          {doc.title}
        </h1>
        <div className="reader-controls">
          <button className="icon-btn" aria-label="Previous page" onClick={() => goto(page - 1)} disabled={page <= 1}>
            <IconChevronLeft />
          </button>
          <span className="pager" data-testid="pager">
            <input
              className="pager-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={doc.numPages}
              value={page}
              aria-label="Page number"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) goto(n);
              }}
            />
            <span className="pager-total">/ {doc.numPages}</span>
          </span>
          <button className="icon-btn" aria-label="Next page" onClick={() => goto(page + 1)} disabled={page >= doc.numPages} data-testid="next-page">
            <IconChevronRight />
          </button>
          <span className="bar-sep" />
          <button className="icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(+(z - 0.15).toFixed(2), 0.7, 2.4))}>
            <IconMinus />
          </button>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(+(z + 0.15).toFixed(2), 0.7, 2.4))}>
            <IconPlus />
          </button>
          <button
            className={`pill ${circle ? 'pill-on' : ''}`}
            aria-pressed={circle}
            onClick={() => {
              setCircle((c) => !c);
              window.getSelection()?.removeAllRanges();
              clearOverlay();
            }}
            data-testid="circle-toggle"
          >
            <IconCircle /> Circle
          </button>
        </div>
      </div>

      {circle && <div className="mode-banner">Circle mode: draw a loop around a word. Tap Circle again to scroll or select text.</div>}

      <div className="reader-scroll" ref={wrapRef}>
        {loadError && <div className="notice notice-err">Could not open this document: {loadError}</div>}
        <div className="page-box" ref={boxRef} data-kind={doc.kind}>
          {doc.kind === 'pdf' ? (
            <>
              <canvas ref={canvasRef} className="pdf-canvas" />
              <div ref={textRef} className="textLayer" data-testid="text-layer" />
            </>
          ) : (
            <div ref={textRef} className="textpage" style={{ fontSize: `${1.06 * zoom}rem` }} data-testid="text-page">
              {paragraphs.map((p, i) => (
                <p key={`${page}-${i}`} className={i === 0 && p.length < 90 && !/[.।]$/.test(p.trim()) ? 'ph' : undefined}>
                  {p}
                </p>
              ))}
            </div>
          )}
          <canvas
            ref={overlayRef}
            className={`overlay ${circle ? 'overlay-on' : ''}`}
            data-testid="circle-overlay"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>

      {hint && (
        <div className="reader-hint" role="status">
          {hint}
        </div>
      )}

      {pending && (
        <ConfirmSheet
          key={`${pending.start}-${pending.end}-${page}`}
          candidate={pending}
          source={pending.source}
          docTitle={doc.title}
          page={page}
          saving={saving}
          encrypted={settings.backend === 'memwal' || settings.encrypt}
          backendLabel={backendLabel}
          onSave={confirm}
          onCancel={cancel}
        />
      )}
    </section>
  );
}
