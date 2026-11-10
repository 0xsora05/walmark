'use client';

import { useState } from 'react';
import { IconCheck, IconLock } from './icons';
import type { Candidate } from '@/lib/text';

interface Props {
  candidate: Candidate;
  source: 'select' | 'circle';
  docTitle: string;
  page: number;
  saving: boolean;
  encrypted: boolean;
  backendLabel: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}

function Emphasised({ context, word }: { context: string; word: string }) {
  const i = context.toLowerCase().indexOf(word.toLowerCase());
  if (!context) return null;
  if (i < 0) return <>{context}</>;
  return (
    <>
      {context.slice(0, i)}
      <mark>{context.slice(i, i + word.length)}</mark>
      {context.slice(i + word.length)}
    </>
  );
}

/** The "Save to memory?" question. Nothing is written anywhere until the user taps Save. */
export default function ConfirmSheet({ candidate, source, docTitle, page, saving, encrypted, backendLabel, onSave, onCancel }: Props) {
  const [note, setNote] = useState('');

  return (
    <div className="sheet-backdrop" role="presentation">
      <div className="sheet" role="dialog" aria-modal="false" aria-label="Save to memory?" data-testid="confirm-sheet">
        <div className="sheet-grab" />
        <p className="eyebrow">{source === 'circle' ? 'Circled' : 'Highlighted'} · Save to memory?</p>
        <h2 className="sheet-word" data-testid="sheet-word">{candidate.word}</h2>
        <p className="sheet-context">
          <Emphasised context={candidate.context} word={candidate.word} />
        </p>
        <p className="sheet-meta">
          <span className="chip">{docTitle}</span>
          <span className="chip">Page {page}</span>
          <span className="chip chip-quiet">
            {encrypted && <IconLock />} {backendLabel}
          </span>
        </p>
        <input
          className="input"
          placeholder="Add a note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Optional note"
        />
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving} data-testid="cancel-save">
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave(note)} disabled={saving} data-testid="confirm-save">
            {saving ? 'Saving…' : (<><IconCheck /> Save to memory</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
