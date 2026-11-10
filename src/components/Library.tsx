'use client';

import { useRef, useState } from 'react';
import { IconBook, IconTrash, IconUpload } from './icons';
import type { DocRecord, MemoryRecord } from '@/lib/types';

interface Props {
  docs: DocRecord[];
  memories: MemoryRecord[];
  busy: boolean;
  onFiles: (files: File[]) => void;
  onPaste: (title: string, text: string) => void;
  onSample: () => void;
  onOpen: (doc: DocRecord) => void;
  onDelete: (doc: DocRecord) => void;
}

export default function Library({ docs, memories, busy, onFiles, onPaste, onSample, onOpen, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  const countFor = (id: string) => memories.filter((m) => m.docId === id).length;

  return (
    <section className="library" data-testid="library">
      <div className="hero">
        <p className="eyebrow">WalMark</p>
        <h1>Mark it. Walrus remembers it.</h1>
        <p className="lede">
          Highlight or circle a word in a document. Confirm, and it is saved to Walrus. Ask for it later and get it back with the page and the title.
        </p>
      </div>

      <div
        className={`drop ${drag ? 'drop-on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <IconUpload />
        <div>
          <strong>Add a PDF or text file</strong>
          <span className="muted"> · stays in your browser</span>
        </div>
        <div className="drop-actions">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="add-file">
            Choose file
          </button>
          <button className="btn btn-ghost" onClick={() => setPasteOpen((o) => !o)}>
            Paste text
          </button>
          <button className="btn btn-ghost" onClick={onSample} disabled={busy} data-testid="load-sample">
            Try the sample
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
          data-testid="file-input"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {pasteOpen && (
        <form
          className="paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onPaste(title.trim() || 'Pasted text', text);
            setTitle('');
            setText('');
            setPasteOpen(false);
          }}
        >
          <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Document title" />
          <textarea className="input" rows={7} placeholder="Paste your text here (Tamil works too)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Document text" />
          <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
            Add document
          </button>
        </form>
      )}

      <h2 className="section-title">Your documents</h2>
      {docs.length === 0 ? (
        <p className="muted">Nothing here yet. Add a file or try the sample to see the flow in a minute.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="doc-card" data-testid="doc-card">
              <button className="doc-main" onClick={() => onOpen(d)}>
                <span className="doc-icon">
                  <IconBook />
                </span>
                <span className="doc-text">
                  <strong>{d.title}</strong>
                  <span className="muted">
                    {d.kind === 'pdf' ? 'PDF' : 'Text'} · {d.numPages} {d.numPages === 1 ? 'page' : 'pages'} · {countFor(d.id)} saved
                    {d.lastPage > 1 ? ` · resume p.${d.lastPage}` : ''}
                  </span>
                </span>
              </button>
              <button
                className="icon-btn icon-btn-danger"
                aria-label={`Remove ${d.title}`}
                onClick={() => {
                  if (window.confirm(`Remove “${d.title}” from this device? Words you saved from it stay in your memory.`)) onDelete(d);
                }}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
