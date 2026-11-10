import type { LearnPayload, MemoryPayload, MemoryRecord } from './types';

/**
 * MemWal indexes free text with embeddings, so each memory is written as a natural sentence
 * (good for semantic recall) plus one machine-readable trailer line (so we can rebuild the
 * exact word / title / page when it comes back).
 */

export function formatMemwalText(m: Pick<MemoryRecord, 'id' | 'word' | 'context' | 'note' | 'docId' | 'docTitle' | 'page' | 'createdAt'>): string {
  const payload: MemoryPayload = {
    v: 1,
    app: 'walmark',
    id: m.id,
    word: m.word,
    context: m.context,
    note: m.note,
    docId: m.docId,
    docTitle: m.docTitle,
    page: m.page,
    createdAt: m.createdAt,
  };
  const note = m.note ? ` Note: ${m.note}.` : '';
  return `Marked “${m.word}” in “${m.docTitle}”, page ${m.page}. Sentence: ${m.context}${note}\n#walmark ${JSON.stringify(payload)}`;
}

export function parseMemwalText(text: string): MemoryPayload | null {
  const line = text.split('\n').reverse().find((l) => l.startsWith('#walmark '));
  if (!line) return null;
  try {
    const p = JSON.parse(line.slice('#walmark '.length)) as MemoryPayload;
    return p && p.app === 'walmark' && typeof p.word === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** A lesson is stored as a sentence (so semantic recall finds it) plus a machine-readable trailer. */
export function formatLearnText(p: LearnPayload): string {
  const said = p.terms.map((t) => `“${t}”`).join(', ');
  const sentence =
    p.kind === 'alias'
      ? `Learned: when I ask ${said}, I mean “${p.word}” from “${p.docTitle}”, page ${p.page}.`
      : `Learned: when I ask ${said}, I do NOT mean “${p.word}” from “${p.docTitle}”, page ${p.page}.`;
  return `${sentence}\n#walmark-learn ${JSON.stringify(p)}`;
}

export function parseLearnText(text: string): LearnPayload | null {
  const line = text.split('\n').reverse().find((l) => l.startsWith('#walmark-learn '));
  if (!line) return null;
  try {
    const p = JSON.parse(line.slice('#walmark-learn '.length)) as LearnPayload;
    const ok = p && p.app === 'walmark' && (p.kind === 'alias' || p.kind === 'avoid') && typeof p.memoryId === 'string' && Array.isArray(p.terms);
    return ok ? p : null;
  } catch {
    return null;
  }
}
