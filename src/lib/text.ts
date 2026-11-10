import type { MemoryRecord } from './types';

/**
 * DOM text helpers shared by the PDF text layer and the plain-text pages.
 * Everything works on a flat string (`TextIndex.text`) plus a map back to DOM text nodes,
 * so a "word" can be located, highlighted and turned into a sentence regardless of how
 * pdf.js split it into spans.
 */

export const WORD_RE = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
export const MAX_WORDS = 12;
export const MAX_CHARS = 140;

export interface TextIndex {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
}

export interface Candidate {
  word: string;
  context: string;
  start: number;
  end: number;
}

export interface WordBox {
  start: number;
  end: number;
  text: string;
  cx: number;
  cy: number;
}

export function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  let prevParent: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as Element).tagName;
      if ((tag === 'BR' || tag === 'P') && text && !/\s$/.test(text)) text += tag === 'P' ? '\n' : ' ';
    } else {
      const t = n as Text;
      if (t.data.length) {
        const parent = t.parentElement;
        // pdf.js often splits a line into several spans without a space between them.
        if (prevParent && parent !== prevParent && text && !/\s$/.test(text) && !/^\s/.test(t.data)) text += ' ';
        nodes.push({ node: t, start: text.length, end: text.length + t.data.length });
        text += t.data;
        prevParent = parent;
      }
    }
    n = walker.nextNode();
  }
  return { text, nodes };
}

export function offsetOf(idx: TextIndex, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const e = idx.nodes.find((x) => x.node === node);
    return e ? e.start + offset : null;
  }
  const child = node.childNodes[offset];
  if (child) {
    const e = idx.nodes.find((x) => child.contains(x.node));
    return e ? e.start : null;
  }
  for (let i = idx.nodes.length - 1; i >= 0; i--) {
    if (node.contains(idx.nodes[i].node)) return idx.nodes[i].end;
  }
  return null;
}

function locate(idx: TextIndex, pos: number, isEnd: boolean): { node: Text; offset: number } | null {
  for (const e of idx.nodes) {
    if (isEnd ? pos > e.start && pos <= e.end : pos >= e.start && pos < e.end) {
      return { node: e.node, offset: pos - e.start };
    }
  }
  return null;
}

export function rangeFromOffsets(idx: TextIndex, start: number, end: number): Range | null {
  const a = locate(idx, start, false);
  const b = locate(idx, end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return r;
}

const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'no', 'art', 'vs', 'etc', 'sri', 'smt', 'fig', 'sec', 'ch', 'vol', 'pp']);

/** True when text[i] is a full stop that really ends a sentence (not "Dr.", "B. R." or "e.g."). */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === '!' || ch === '?' || ch === '।') return true;
  if (ch !== '.') return false;
  let j = i;
  while (j > 0 && /[\p{L}]/u.test(text[j - 1])) j--;
  const token = text.slice(j, i).toLowerCase();
  if (token.length === 1) return false; // single initial such as "B." or the "e" / "g" of "e.g."
  return !ABBREVIATIONS.has(token);
}

export function sentenceAround(text: string, start: number, end: number): string {
  let s = start;
  while (s > 0 && start - s < 280) {
    if (text[s - 1] === '\n') break;
    if (/\s/.test(text[s] ?? ' ') && endsSentence(text, s - 1)) break;
    s--;
  }
  let e = end;
  while (e < text.length && e - end < 280) {
    if (text[e] === '\n') break;
    const stop = endsSentence(text, e);
    e++;
    if (stop) break;
  }
  return text.slice(s, e).replace(/\s+/g, ' ').trim();
}

function candidateFrom(idx: TextIndex, start: number, end: number): Candidate | null {
  let s = start;
  let e = end;
  // expand to whole words, then trim stray punctuation/space
  while (s > 0 && WORD_CHAR.test(idx.text[s - 1]) && WORD_CHAR.test(idx.text[s] ?? '')) s--;
  while (e < idx.text.length && WORD_CHAR.test(idx.text[e]) && WORD_CHAR.test(idx.text[e - 1] ?? '')) e++;
  while (s < e && !WORD_CHAR.test(idx.text[s])) s++;
  while (e > s && !WORD_CHAR.test(idx.text[e - 1])) e--;
  const raw = idx.text.slice(s, e);
  const word = raw.replace(/\s+/g, ' ').trim();
  if (!word) return null;
  if (word.length > MAX_CHARS || (word.match(WORD_RE)?.length ?? 0) > MAX_WORDS) return null;
  return { word, context: sentenceAround(idx.text, s, e), start: s, end: e };
}

export type SelectionResult = { candidate: Candidate } | { tooLong: true } | null;

export function selectionToCandidate(root: HTMLElement, idx: TextIndex): SelectionResult {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const s = offsetOf(idx, range.startContainer, range.startOffset);
  const e = offsetOf(idx, range.endContainer, range.endOffset);
  if (s === null || e === null || e <= s) return null;
  const c = candidateFrom(idx, s, e);
  return c ? { candidate: c } : { tooLong: true };
}

/** Every word on the page with the centre of its on-screen box (client coordinates). */
export function collectWords(idx: TextIndex): WordBox[] {
  const out: WordBox[] = [];
  for (const m of idx.text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const r = rangeFromOffsets(idx, start, end);
    if (!r) continue;
    const rect = r.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    out.push({ start, end, text: m[0], cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
  }
  return out;
}

export function candidateFromWords(idx: TextIndex, words: WordBox[]): Candidate | null {
  if (!words.length) return null;
  const sorted = [...words].sort((a, b) => a.start - b.start);
  return candidateFrom(idx, sorted[0].start, sorted[sorted.length - 1].end);
}

function collapse(text: string): { s: string; map: number[] } {
  let s = '';
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        s += ' ';
        map.push(i);
      }
      lastSpace = true;
    } else {
      const lc = ch.toLowerCase();
      s += lc.length === 1 ? lc : ch;
      map.push(i);
      lastSpace = false;
    }
  }
  return { s, map };
}

/** Where saved memories of this page sit in the text layer, so they can be re-highlighted. */
export function findHighlightRanges(idx: TextIndex, memories: Pick<MemoryRecord, 'word' | 'context'>[]): Range[] {
  if (!memories.length) return [];
  const { s, map } = collapse(idx.text);
  const ranges: Range[] = [];
  for (const m of memories) {
    const word = m.word.replace(/\s+/g, ' ').toLowerCase();
    const ctx = m.context.replace(/\s+/g, ' ').toLowerCase();
    if (!word) continue;
    const ci = ctx ? s.indexOf(ctx) : -1;
    let wi = ci >= 0 ? s.indexOf(word, ci) : -1;
    if (wi < 0 || (ci >= 0 && wi > ci + ctx.length)) wi = s.indexOf(word);
    if (wi < 0) continue;
    const start = map[wi];
    const end = map[wi + word.length - 1] + 1;
    const r = rangeFromOffsets(idx, start, end);
    if (r) ranges.push(r);
  }
  return ranges;
}
