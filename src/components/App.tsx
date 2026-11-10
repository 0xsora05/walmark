'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Library from './Library';
import Reader from './Reader';
import Recall from './Recall';
import SettingsSheet from './SettingsSheet';
import { IconAsk, IconBook, IconGear, IconLibrary } from './icons';
import { deleteDoc, deleteMemory, listDocs, listMemories, putDoc, uid, wipeAll } from '@/lib/db';
import { paginate } from '@/lib/paginate';
import { loadPdf } from '@/lib/pdf';
import { SAMPLE_PAGES, SAMPLE_TITLE } from '@/lib/sample';
import { exportBackup, restoreBackup, retrySync, saveMemory } from '@/lib/service';
import { DEFAULT_SETTINGS, type DocRecord, type MemoryRecord, type ServerInfo, type Settings } from '@/lib/types';

type View = 'library' | 'reader' | 'recall';
type Tone = 'ok' | 'warn' | 'err';

const SETTINGS_KEY = 'walmark.settings';

function hasStoredSettings(): boolean {
  try {
    return window.localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* private mode or corrupted value: fall back to defaults */
  }
  return DEFAULT_SETTINGS;
}

function persistSettings(s: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export default function App() {
  const [view, setView] = useState<View>('library');
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [current, setCurrent] = useState<{ doc: DocRecord; page: number } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; msg: string; tone: Tone } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const notify = useCallback((msg: string, tone: Tone = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: ++toastId.current, msg, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'ok' ? 3200 : 6500);
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    void (async () => {
      setDocs(await listDocs());
      setMemories(await listMemories());
    })();
    fetch('/api/config')
      .then((r) => (r.ok ? (r.json() as Promise<ServerInfo>) : null))
      .then((info) => {
        if (!info) return;
        setServer(info);
        // First run, or the chosen backend can't work on this server: follow what the server offers.
        setSettings((cur) => {
          const works = (b: Settings['backend']) =>
            b === 'sui' ? info.sui.enabled : b === 'memwal' ? info.memwal.enabled : info.walrus.canWrite;
          // Walrus Memory (MemWal) first: it is what the Total Recall hackathon requires on mainnet. Then the direct
          // Sui + Walrus path (Tatum RPC), then plain blobs.
          const best: Settings['backend'] = info.memwal.enabled ? 'memwal' : info.sui.enabled ? 'sui' : 'walrus';
          const prefer: Settings['backend'] | null = !hasStoredSettings() ? best : works(cur.backend) ? null : works(best) ? best : null;
          if (!prefer || prefer === cur.backend) return cur;
          const next = { ...cur, backend: prefer };
          persistSettings(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    persistSettings(s);
  };

  /* ---------- documents ---------- */
  const addDoc = async (doc: DocRecord, file?: ArrayBuffer) => {
    await putDoc(doc, file);
    setDocs(await listDocs());
  };

  const addText = async (title: string, text: string) => {
    const pages = paginate(text);
    const doc: DocRecord = { id: uid(), title, kind: 'text', numPages: pages.length, createdAt: Date.now(), lastPage: 1, pages };
    await addDoc(doc);
    return doc;
  };

  const addPdf = async (file: File) => {
    const data = await file.arrayBuffer();
    const pdf = await loadPdf(data);
    const numPages = pdf.numPages;
    void pdf.destroy();
    const doc: DocRecord = {
      id: uid(),
      title: file.name.replace(/\.pdf$/i, ''),
      kind: 'pdf',
      numPages,
      createdAt: Date.now(),
      lastPage: 1,
    };
    await addDoc(doc, data);
    return doc;
  };

  const openDoc = (doc: DocRecord, page?: number) => {
    setCurrent({ doc, page: page ?? doc.lastPage });
    setView('reader');
  };

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    let last: DocRecord | null = null;
    try {
      for (const f of files) {
        try {
          if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') last = await addPdf(f);
          else if (/\.(txt|md|markdown)$/i.test(f.name) || f.type.startsWith('text/')) {
            last = await addText(f.name.replace(/\.[^.]+$/, ''), await f.text());
          } else notify(`“${f.name}” is not a PDF or text file.`, 'warn');
        } catch (e) {
          notify(`Could not read “${f.name}”: ${e instanceof Error ? e.message : 'unknown error'}`, 'err');
        }
      }
    } finally {
      setBusy(false);
    }
    if (last && files.length === 1) openDoc(last, 1);
    else if (last) notify(`Added ${files.length} documents.`);
  };

  const onPaste = async (title: string, text: string) => {
    const doc = await addText(title, text);
    openDoc(doc, 1);
  };

  const onSample = async () => {
    setBusy(true);
    try {
      const existing = docs.find((d) => d.title === SAMPLE_TITLE);
      if (existing) {
        openDoc(existing);
        return;
      }
      const doc: DocRecord = { id: uid(), title: SAMPLE_TITLE, kind: 'text', numPages: SAMPLE_PAGES.length, createdAt: Date.now(), lastPage: 1, pages: SAMPLE_PAGES };
      await addDoc(doc);
      openDoc(doc, 1);
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (doc: DocRecord) => {
    await deleteDoc(doc.id);
    setDocs(await listDocs());
    if (current?.doc.id === doc.id) {
      setCurrent(null);
      setView('library');
    }
  };

  const onPage = useCallback(
    (page: number) => {
      if (!current) return;
      const updated = { ...current.doc, lastPage: page };
      void putDoc(updated);
      setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    },
    [current],
  );

  /* ---------- memories ---------- */
  const onSave = async (req: { word: string; context: string; note?: string; page: number }) => {
    if (!current) return;
    const rec = await saveMemory({ ...req, docId: current.doc.id, docTitle: current.doc.title }, settings);
    setMemories((prev) => [rec, ...prev.filter((m) => m.id !== rec.id)]);
    if (rec.status === 'synced') {
      notify(`Saved “${rec.word}” to ${rec.backend === 'memwal' ? 'Walrus Memory' : rec.backend === 'sui' ? 'Walrus on Sui' : 'Walrus'}.`, 'ok');
    } else {
      notify(`Saved “${rec.word}” on this device, but Walrus failed: ${rec.error ?? 'unknown error'}. Retry it from Recall > All saved.`, 'warn');
    }
  };

  const onRetry = async (id: string) => {
    const m = memories.find((x) => x.id === id);
    if (!m) return;
    const next = await retrySync(m, settings);
    setMemories((prev) => prev.map((x) => (x.id === id ? next : x)));
    if (next.status === 'synced') notify(`“${next.word}” is now on Walrus.`, 'ok');
    else notify(`Still failing: ${next.error ?? 'unknown error'}`, 'warn');
  };

  const onMemoryChanged = (next: MemoryRecord) => {
    setMemories((prev) => (prev.some((x) => x.id === next.id) ? prev.map((x) => (x.id === next.id ? next : x)) : [next, ...prev]));
  };

  const onDeleteMemory = async (id: string) => {
    await deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  /* ---------- backup ---------- */
  const onExport = async () => {
    const blob = new Blob([await exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `walmark-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    notify('Backup downloaded. It contains your key, so keep it private.', 'ok');
  };

  const onRestore = async (file: File) => {
    try {
      const r = await restoreBackup(await file.text());
      setMemories(await listMemories());
      notify(`Restored ${r.restored}, skipped ${r.skipped}${r.failed ? `, ${r.failed} could not be fetched from Walrus` : ''}.`, r.failed ? 'warn' : 'ok');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Restore failed', 'err');
    }
  };

  const onWipe = async () => {
    await wipeAll();
    setDocs([]);
    setMemories([]);
    setCurrent(null);
    setView('library');
    setShowSettings(false);
    notify('Everything on this device was erased.', 'ok');
  };

  const unsynced = memories.filter((m) => m.status !== 'synced').length;
  const activeView: View = view === 'reader' && !current ? 'library' : view;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('library')} aria-label="WalMark home">
          <span className="brand-mark" aria-hidden="true" />
          WalMark
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={() => setShowSettings(true)} data-testid="open-settings">
          <IconGear />
        </button>
      </header>

      <main className="main">
        {activeView === 'library' && (
          <Library docs={docs} memories={memories} busy={busy} onFiles={onFiles} onPaste={onPaste} onSample={onSample} onOpen={(d) => openDoc(d)} onDelete={removeDoc} />
        )}
        {activeView === 'reader' && current && (
          <Reader
            key={current.doc.id + ':' + current.page}
            doc={current.doc}
            memories={memories}
            initialPage={current.page}
            settings={settings}
            onPage={onPage}
            onSave={onSave}
          />
        )}
        {activeView === 'recall' && (
          <Recall
            memories={memories}
            docs={docs}
            settings={settings}
            server={server}
            onOpen={(docId, page) => {
              const d = docs.find((x) => x.id === docId);
              if (d) openDoc(d, page);
            }}
            onDelete={onDeleteMemory}
            onRetry={onRetry}
            onMemoryChanged={onMemoryChanged}
            onToast={notify}
            reloadMemories={async () => setMemories(await listMemories())}
          />
        )}
      </main>

      <nav className="tabbar" aria-label="Sections">
        <button className={activeView === 'library' ? 'on' : ''} onClick={() => setView('library')} data-testid="nav-library">
          <IconLibrary />
          <span>Library</span>
        </button>
        <button className={activeView === 'reader' ? 'on' : ''} onClick={() => current && setView('reader')} disabled={!current} data-testid="nav-reader">
          <IconBook />
          <span>Read</span>
        </button>
        <button className={activeView === 'recall' ? 'on' : ''} onClick={() => setView('recall')} data-testid="nav-recall">
          <IconAsk />
          <span>Recall</span>
          {unsynced > 0 && <i className="dot" aria-label={`${unsynced} not synced`} />}
        </button>
      </nav>

      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role="status" data-testid="toast">
          {toast.msg}
        </div>
      )}

      {showSettings && (
        <SettingsSheet
          settings={settings}
          server={server}
          memoryCount={memories.length}
          onChange={updateSettings}
          onExport={onExport}
          onRestore={onRestore}
          onWipe={onWipe}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
