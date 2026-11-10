import type { MemoryRecord } from './types';

/**
 * Local recall: understands "what did I mark on page 3", "last word from Indian Polity",
 * and Tanglish like "antha federalism word enna?". No network, no model, works offline.
 */

const STOPWORDS = new Set(
  `a an the is are was were be been am do does did to of in on at for from by with and or as it its this that these those
  i me my mine we our you your he she they them his her what which who whom where when why how can could would should will shall
  please show tell find search recall remember remind give get list all any some about again
  word words mark marked marking highlight highlighted circle circled save saved saving memory memories
  document doc docs title page pages number no
  antha andha intha indha idhu adhu enna edhu yedhu entha endha yenna evlo naan nan na nanga en ennoda enakku
  panna pannina pannuna panninen pannen pannitu pannunen panninaen panninadhu pannanum pannu pannunga
  sollu sollunga solluga kaattu kaatu kaatunga kattu kudu kudunga paaru paarunga thedu
  la le ku kku oda ah aa nu nnu ana aana irukku irundhu irukka vandhuchu vanthuchu kitta kita
  அந்த இந்த என்ன எது நான் என் எனக்கு எனது பக்கம் வார்த்தை சொல் குறி`
    .split(/\s+/)
    .filter(Boolean),
);

export interface ParsedQuery {
  raw: string;
  terms: string[];
  page: number | null;
  latest: boolean;
}

export interface SearchHit {
  memory: MemoryRecord;
  score: number;
}

export function tokenize(input: string): string[] {
  return input.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

const PAGE_PATTERNS: RegExp[] = [
  /\b(?:page|pg|pages)\s*(?:no\.?|number|#)?\s*(\d{1,4})\b/i,
  /\b(\d{1,4})\s*(?:st|nd|rd|th)?\s*(?:page|pg)\b/i,
  /(?:பக்கம்|பக்\.?)\s*(\d{1,4})/u,
  /(\d{1,4})\s*(?:ஆம்\s*)?பக்கம்/u,
];

const LATEST_RE = /\b(last|latest|recent|recently|newest|previous|kadaisi|kadaisiya|kadaisila|kadasi)\b/i;

export function parseQuery(raw: string): ParsedQuery {
  let q = raw;
  let page: number | null = null;
  for (const re of PAGE_PATTERNS) {
    const m = re.exec(q);
    if (m) {
      page = parseInt(m[1], 10);
      q = q.replace(re, ' ');
      break;
    }
  }
  const latest = LATEST_RE.test(q);
  const terms = tokenize(q).filter((t) => !STOPWORDS.has(t) && !LATEST_RE.test(t) && !/^\d+$/.test(t));
  return { raw, terms, page, latest };
}

/** Levenshtein distance with an early exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyLimit(len: number): number {
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0;
}

/** Terms from a query that are worth remembering as a nickname for a mark. */
export function learnableTerms(query: string): string[] {
  return parseQuery(query).terms.filter((t) => t.length >= 2);
}

function scoreMemory(m: MemoryRecord, terms: string[]): number {
  const wordTokens = tokenize(m.word);
  const aliasTokens = (m.aliases ?? []).flatMap(tokenize);
  const avoid = new Set(m.avoid ?? []);
  const ctxTokens = tokenize(m.context);
  const titleTokens = tokenize(m.docTitle);
  const noteTokens = m.note ? tokenize(m.note) : [];
  let score = 0;

  for (const t of terms) {
    let best = 0;
    for (const w of wordTokens) {
      if (w === t) best = Math.max(best, 10);
      else if (t.length >= 3 && (w.startsWith(t) || t.startsWith(w)) && w.length >= 3) best = Math.max(best, 7);
      else if (t.length >= 4 && w.includes(t)) best = Math.max(best, 5);
      else {
        const lim = Math.min(fuzzyLimit(t.length), fuzzyLimit(w.length));
        if (lim > 0 && editDistance(t, w, lim) <= lim) best = Math.max(best, 5);
      }
    }
    for (const w of ctxTokens) {
      if (w === t) best = Math.max(best, 3);
      else if (t.length >= 4 && w.startsWith(t)) best = Math.max(best, 1.5);
    }
    for (const w of titleTokens) if (w === t) best = Math.max(best, 3);
    for (const w of noteTokens) if (w === t) best = Math.max(best, 3);
    // What you taught it: a nickname you confirmed counts almost as much as the word itself.
    for (const w of aliasTokens) if (w === t) best = Math.max(best, 9);
    // What you told it was wrong for this term: demote instead of hiding, in case you change your mind.
    if (avoid.has(t) && best > 0) best = best * 0.2;
    score += best;
  }
  // Marks you keep confirming rise a little with each confirmation (capped, so one favourite cannot bury the rest).
  if (score > 0 && m.confirmed) score += Math.min(m.confirmed, 5) * 0.5;
  return score;
}

export function search(memories: MemoryRecord[], query: string, limit = 8): SearchHit[] {
  const q = parseQuery(query);
  let pool = memories;
  if (q.page !== null) pool = pool.filter((m) => m.page === q.page);

  if (q.terms.length === 0) {
    const newest = [...pool].sort((a, b) => b.createdAt - a.createdAt);
    return newest.slice(0, q.latest ? 1 : limit).map((memory) => ({ memory, score: 1 }));
  }

  const hits = pool
    .map((memory) => ({ memory, score: scoreMemory(memory, q.terms) }))
    .filter((h) => h.score > 0);

  if (q.latest) hits.sort((a, b) => b.memory.createdAt - a.memory.createdAt);
  else hits.sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt);
  return hits.slice(0, limit);
}
