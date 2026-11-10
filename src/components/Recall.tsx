'use client';

import { useEffect, useRef, useState } from 'react';
import { IconBook, IconCheck, IconLock, IconRetry, IconSend, IconTrash } from './icons';
import { search } from '@/lib/search';
import { giveFeedback, memwalRecall, memwalWriteCount, syncLearning, verifyOnSui, type SuiVerify } from '@/lib/service';
import type { DocRecord, MemoryRecord, ServerInfo, Settings } from '@/lib/types';

interface Hit {
  memory: MemoryRecord;
  semantic?: boolean;
  /** Found because of a lesson you taught it, not because the words matched. */
  learned?: boolean;
}

interface Msg {
  id: number;
  role: 'me' | 'bot';
  text: string;
  hits?: Hit[];
  /** The question this answer belongs to, so feedback knows which words to learn. */
  query?: string;
  /** Nothing matched: offer recent marks so you can point at the one you meant. WalMark learns your wording from that. */
  pick?: MemoryRecord[];
}

interface Props {
  memories: MemoryRecord[];
  docs: DocRecord[];
  settings: Settings;
  server: ServerInfo | null;
  onOpen: (docId: string, page: number) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onMemoryChanged: (m: MemoryRecord) => void;
  onToast: (msg: string, tone?: 'ok' | 'warn' | 'err') => void;
  reloadMemories: () => Promise<void>;
}

const SUGGESTIONS = ['Show my latest mark', 'What did I mark on page 3?', 'federalism', 'antha article 32 word enna?'];

function shortId(id?: string): string {
  if (!id) return '';
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-5)}` : id;
}

function Emphasised({ context, word }: { context: string; word: string }) {
  const i = context.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return <>{context}</>;
  return (
    <>
      {context.slice(0, i)}
      <mark>{context.slice(i, i + word.length)}</mark>
      {context.slice(i + word.length)}
    </>
  );
}

function SyncBadge({ m }: { m: MemoryRecord }) {
  if (m.status === 'synced') {
    return (
      <span className="chip chip-ok" title={m.blobId}>
        <IconCheck /> {m.backend === 'memwal' ? 'MemWal' : m.backend === 'sui' ? 'Sui + Walrus' : 'Walrus'} · {shortId(m.blobId)}
        {m.encrypted && <IconLock />}
      </span>
    );
  }
  return (
    <span className="chip chip-warn" title={m.error}>
      Saved on this device only
    </span>
  );
}

/** Reads the Walrus Blob object from Sui through the Tatum RPC and says whether the mark is really there. */
function VerifyButton({ m, settings }: { m: MemoryRecord; settings: Settings }) {
  const [state, setState] = useState<{ busy: boolean; res?: SuiVerify; err?: string }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try {
      setState({ busy: false, res: await verifyOnSui(m, settings) });
    } catch (e) {
      setState({ busy: false, err: e instanceof Error ? e.message : 'Could not verify' });
    }
  };
  const r = state.res;
  return (
    <>
      <button className={`btn btn-small btn-ghost ${r?.verified ? 'verified' : ''}`} onClick={run} disabled={state.busy} data-testid="verify-sui">
        <IconCheck /> {state.busy ? 'Checking…' : r ? (r.verified ? 'Verified on Sui' : 'Not verified') : 'Verify on Sui'}
      </button>
      {r && (
        <p className={`mem-note small ${r.verified ? 'ok' : 'err'}`} data-testid="verify-result">
          {r.verified
            ? `On Sui via Tatum RPC: Walrus blob is certified${r.epochsLeft !== undefined ? `, stored for ${r.epochsLeft} more epoch${r.epochsLeft === 1 ? '' : 's'}` : ''}.`
            : !r.exists
              ? 'The blob object was not found on Sui.'
              : r.matchesBlobId === false
                ? 'The object on Sui holds a different blob ID.'
                : r.epochsLeft === 0
                  ? 'The storage period has ended.'
                  : 'The object exists but is not a certified Walrus blob.'}
          {m.suiObjectId && !r.mock && (
            <>
              {' '}
              <a href={`https://suiscan.xyz/mainnet/object/${m.suiObjectId}`} target="_blank" rel="noreferrer">
                View on Suiscan
              </a>
            </>
          )}
        </p>
      )}
      {state.err && <p className="mem-note small err">{state.err}</p>}
    </>
  );
}

/** "Right one" / "Not it": this is the learning loop. The answer changes the next time you ask. */
function Feedback({ m, query, settings, onChanged, onToast, pick }: { m: MemoryRecord; query: string; settings: Settings; onChanged: (m: MemoryRecord) => void; onToast: Props['onToast']; pick?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; done?: string }>({ busy: false });
  const send = async (verdict: 'right' | 'wrong') => {
    setState({ busy: true });
    const r = await giveFeedback(m, query, verdict, settings);
    onChanged(r.memory);
    const quoted = r.learned.map((t) => `“${t}”`).join(', ');
    const msg =
      r.learned.length === 0
        ? verdict === 'right'
          ? 'Noted. This mark will rank higher next time.'
          : 'Noted.'
        : verdict === 'right'
          ? `Learned: ${quoted} now finds “${m.word}”.${r.stored ? ' Saved to Walrus Memory.' : ''}`
          : `Learned: ${quoted} will no longer put “${m.word}” first.${r.stored ? ' Saved to Walrus Memory.' : ''}`;
    setState({ busy: false, done: msg });
    onToast(r.error ? `Learned on this device. Walrus Memory write failed: ${r.error}` : msg, r.error ? 'warn' : 'ok');
  };
  if (state.done) return <p className="mem-note small ok" data-testid="feedback-done">{state.done}</p>;
  if (pick) {
    return (
      <div className="feedback">
        <button className="btn btn-small btn-primary" disabled={state.busy} onClick={() => send('right')} data-testid="fb-pick">
          This is the one
        </button>
      </div>
    );
  }
  return (
    <div className="feedback" data-testid="feedback">
      <span className="small muted">Was this what you meant?</span>
      <button className="btn btn-small btn-ghost" disabled={state.busy} onClick={() => send('right')} data-testid="fb-right">
        Right one
      </button>
      <button className="btn btn-small btn-ghost" disabled={state.busy} onClick={() => send('wrong')} data-testid="fb-wrong">
        Not it
      </button>
    </div>
  );
}

function MemoryCard({
  hit,
  settings,
  canOpen,
  onOpen,
  onRetry,
  onDelete,
  feedback,
}: {
  hit: Hit;
  settings: Settings;
  canOpen: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onDelete?: () => void;
  feedback?: React.ReactNode;
}) {
  const m = hit.memory;
  return (
    <article className="mem-card" data-testid="memory-card">
      <header>
        <strong className="mem-word">{m.word}</strong>
        <span className="mem-where">
          {m.docTitle} · Page {m.page}
        </span>
      </header>
      {m.context && (
        <p className="mem-context">
          <Emphasised context={m.context} word={m.word} />
        </p>
      )}
      {m.note && <p className="mem-note">Note: {m.note}</p>}
      {m.aliases && m.aliases.length > 0 && (
        <p className="mem-note small" data-testid="aliases">
          You also call this: {m.aliases.map((a) => `“${a}”`).join(', ')}
        </p>
      )}
      {feedback}
      <footer>
        <SyncBadge m={m} />
        {hit.learned && <span className="chip chip-learned" data-testid="learned-chip">learned from you</span>}
        {hit.semantic && !hit.learned && <span className="chip chip-quiet">semantic match</span>}
        {!!m.confirmed && <span className="chip chip-quiet">confirmed {m.confirmed}×</span>}
        <span className="grow" />
        {m.status !== 'synced' && (
          <button className="btn btn-small btn-ghost" onClick={onRetry}>
            <IconRetry /> Retry
          </button>
        )}
        {m.backend === 'sui' && m.suiObjectId && m.status === 'synced' && <VerifyButton m={m} settings={settings} />}
        {canOpen && (
          <button className="btn btn-small btn-ghost" onClick={onOpen} data-testid="open-page">
            <IconBook /> Open page
          </button>
        )}
        {onDelete && (
          <button className="icon-btn icon-btn-danger" aria-label={`Delete ${m.word}`} onClick={onDelete}>
            <IconTrash />
          </button>
        )}
      </footer>
    </article>
  );
}

/** What WalMark has learned from you, in numbers and in your own words. */
function LearnedPanel({
  memories,
  settings,
  server,
  reloadMemories,
  onToast,
}: {
  memories: MemoryRecord[];
  settings: Settings;
  server: ServerInfo | null;
  reloadMemories: () => Promise<void>;
  onToast: Props['onToast'];
}) {
  const [counts, setCounts] = useState<{ marks: number; lessons: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void memwalWriteCount().then(setCounts);
  }, [memories]);

  const taught = memories.filter((m) => (m.aliases?.length ?? 0) > 0 || (m.avoid?.length ?? 0) > 0 || (m.confirmed ?? 0) > 0);
  const nicknames = memories.reduce((n, m) => n + (m.aliases?.length ?? 0), 0);
  const confirms = memories.reduce((n, m) => n + (m.confirmed ?? 0), 0);
  const corrections = memories.reduce((n, m) => n + (m.avoid?.length ?? 0), 0);
  const memwalOn = Boolean(server?.memwal.enabled && settings.backend === 'memwal');
  const mainnet = server?.memwal.network === 'mainnet';

  const pull = async () => {
    setBusy(true);
    try {
      const r = await syncLearning(settings);
      await reloadMemories();
      onToast(r.applied > 0 ? `Pulled ${r.applied} lesson${r.applied === 1 ? '' : 's'} from Walrus Memory.` : `Nothing new in Walrus Memory (${r.lessons} lesson${r.lessons === 1 ? '' : 's'} checked).`, 'ok');
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Could not read Walrus Memory', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="all" data-testid="learned-panel">
      <div className="learn-stats">
        <div>
          <strong data-testid="stat-nicknames">{nicknames}</strong>
          <span>nicknames learned</span>
        </div>
        <div>
          <strong data-testid="stat-confirms">{confirms}</strong>
          <span>“right one” taps</span>
        </div>
        <div>
          <strong data-testid="stat-corrections">{corrections}</strong>
          <span>corrections</span>
        </div>
      </div>

      {memwalOn && counts && (
        <p className="small" data-testid="mainnet-progress">
          Written to Walrus Memory{mainnet ? ' (mainnet)' : ''}: <strong>{counts.total}</strong> ({counts.marks} {counts.marks === 1 ? 'mark' : 'marks'} + {counts.lessons} {counts.lessons === 1 ? 'lesson' : 'lessons'}).
          {mainnet && counts.total < 10 ? ` ${10 - counts.total} more to reach 10.` : ''}
        </p>
      )}
      {memwalOn && (
        <button className="btn btn-ghost" onClick={pull} disabled={busy} data-testid="pull-lessons">
          {busy ? 'Reading Walrus Memory…' : 'Pull lessons from Walrus Memory'}
        </button>
      )}

      {taught.length === 0 ? (
        <div className="empty">
          <h2>Nothing learned yet</h2>
          <p>Ask for a word, then tap “Right one” on the card you meant. WalMark remembers how you ask and finds it faster next time.</p>
        </div>
      ) : (
        taught.map((m) => (
          <article key={m.id} className="mem-card" data-testid="learned-row">
            <header>
              <strong className="mem-word">{m.word}</strong>
              <span className="mem-where">
                {m.docTitle} · Page {m.page}
              </span>
            </header>
            {m.aliases && m.aliases.length > 0 && <p className="mem-note">You call it: {m.aliases.map((a) => `“${a}”`).join(', ')}</p>}
            {m.avoid && m.avoid.length > 0 && <p className="mem-note">Not for: {m.avoid.map((a) => `“${a}”`).join(', ')}</p>}
            {!!m.confirmed && <p className="mem-note small">Confirmed {m.confirmed}× · ranks higher for your questions</p>}
          </article>
        ))
      )}
    </div>
  );
}

export default function Recall({ memories, docs, settings, server, onOpen, onDelete, onRetry, onMemoryChanged, onToast, reloadMemories }: Props) {
  const [tab, setTab] = useState<'ask' | 'all' | 'learned'>('ask');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const docIds = new Set(docs.map((d) => d.id));
  // Suggestions follow what you actually confirm: the marks you recall most come first.
  const favourites = [...memories].filter((m) => (m.confirmed ?? 0) > 0).sort((a, b) => (b.confirmed ?? 0) - (a.confirmed ?? 0)).slice(0, 2).map((m) => m.word);
  const suggestions = [...favourites, ...SUGGESTIONS].slice(0, 4);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy]);

  const ask = async (text: string) => {
    const query = text.trim();
    if (!query || busy) return;
    setQ('');
    setBusy(true);
    const me: Msg = { id: idRef.current++, role: 'me', text: query };
    setMsgs((m) => [...m, me]);

    let hits: Hit[] = search(memories, query, 6).map((h) => ({ memory: h.memory }));
    let note = '';
    if (settings.backend === 'memwal' && server?.memwal.enabled) {
      try {
        const sem = await memwalRecall(query, settings, 6);
        // Lessons you taught earlier go first: they are your own words for a mark.
        const lessons = sem.filter((x) => x.learned);
        for (const s of lessons) {
          const i = hits.findIndex((h) => h.memory.id === s.memory.id);
          if (i >= 0) hits.splice(i, 1);
        }
        hits = [...lessons.map((s) => ({ memory: s.memory, semantic: true, learned: true })), ...hits];
        const seen = new Set(hits.map((h) => h.memory.id));
        for (const s of sem) {
          if (s.learned || seen.has(s.memory.id)) continue;
          seen.add(s.memory.id);
          hits.push({ memory: memories.find((m) => m.id === s.memory.id) ?? s.memory, semantic: true });
        }
        hits = hits.slice(0, 8);
      } catch (e) {
        note = ` (Semantic recall unavailable: ${e instanceof Error ? e.message : 'error'})`;
      }
    }

    let text2: string;
    let pick: MemoryRecord[] | undefined;
    if (!memories.length && !hits.length) {
      text2 = 'Nothing is saved yet. Open a document, highlight or circle a word, and confirm to save it.' + note;
    } else if (!hits.length) {
      text2 = 'I could not find that. Which of these did you mean? Tap it and I will remember how you ask.' + note;
      pick = [...memories].sort((a, b) => (b.confirmed ?? 0) - (a.confirmed ?? 0) || b.createdAt - a.createdAt).slice(0, 5);
    } else {
      const top = hits[0].memory;
      const taught = hits[0].learned || (top.aliases ?? []).some((a) => query.toLowerCase().includes(a));
      text2 =
        taught
          ? `From what you taught me: “${top.word}” in ${top.docTitle}, page ${top.page}.${note}`
          : hits.length === 1
          ? `You marked “${top.word}” in ${top.docTitle}, page ${top.page}.${note}`
          : `Found ${hits.length} matches. Best match: “${top.word}” in ${top.docTitle}, page ${top.page}.${note}`;
    }
    setMsgs((m) => [...m, { id: idRef.current++, role: 'bot', text: text2, hits, query, pick }]);
    setBusy(false);
  };

  return (
    <section className="recall" data-testid="recall">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'ask'} className={tab === 'ask' ? 'on' : ''} onClick={() => setTab('ask')}>
          Ask
        </button>
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')} data-testid="tab-all">
          All saved ({memories.length})
        </button>
        <button role="tab" aria-selected={tab === 'learned'} className={tab === 'learned' ? 'on' : ''} onClick={() => setTab('learned')} data-testid="tab-learned">
          Learned
        </button>
      </div>

      {tab === 'ask' ? (
        <>
          <div className="chat" data-testid="chat">
            {msgs.length === 0 && (
              <div className="empty">
                <h2>Ask your memory</h2>
                <p>Type a word, a page, or a document name. Answers always come with the title and page.</p>
                <div className="chips">
                  {suggestions.map((s) => (
                    <button key={s} className="chip chip-btn" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`} data-testid={`msg-${m.role}`}>
                <p>{m.text}</p>
                {m.pick?.map((p) => (
                  <MemoryCard
                    key={p.id}
                    hit={{ memory: p }}
                    settings={settings}
                    canOpen={docIds.has(p.docId)}
                    onOpen={() => onOpen(p.docId, p.page)}
                    onRetry={() => onRetry(p.id)}
                    feedback={m.query ? <Feedback pick m={p} query={m.query} settings={settings} onChanged={onMemoryChanged} onToast={onToast} /> : undefined}
                  />
                ))}
                {m.hits?.map((h) => (
                  <MemoryCard
                    key={h.memory.id}
                    hit={h}
                    settings={settings}
                    canOpen={docIds.has(h.memory.docId)}
                    onOpen={() => onOpen(h.memory.docId, h.memory.page)}
                    onRetry={() => onRetry(h.memory.id)}
                    feedback={m.query ? <Feedback m={h.memory} query={m.query} settings={settings} onChanged={onMemoryChanged} onToast={onToast} /> : undefined}
                  />
                ))}
              </div>
            ))}
            {busy && <div className="msg msg-bot muted">Searching…</div>}
            <div ref={endRef} />
          </div>
          <form
            className="askbar"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
          >
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="What did I mark about…"
              enterKeyHint="send"
              aria-label="Ask your memory"
              data-testid="ask-input"
            />
            <button className="btn btn-primary btn-icon" type="submit" aria-label="Ask" disabled={busy || !q.trim()} data-testid="ask-send">
              <IconSend />
            </button>
          </form>
        </>
      ) : tab === 'learned' ? (
        <LearnedPanel memories={memories} settings={settings} server={server} reloadMemories={reloadMemories} onToast={onToast} />
      ) : (
        <div className="all" data-testid="all-saved">
          {memories.length === 0 && <div className="empty"><p>No saved words yet.</p></div>}
          {memories.map((m) => (
            <MemoryCard
              key={m.id}
              hit={{ memory: m }}
              settings={settings}
              canOpen={docIds.has(m.docId)}
              onOpen={() => onOpen(m.docId, m.page)}
              onRetry={() => onRetry(m.id)}
              onDelete={() => {
                if (window.confirm(`Remove “${m.word}” from this device? The copy already on Walrus stays there until its storage expires.`)) onDelete(m.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
