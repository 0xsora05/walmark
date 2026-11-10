import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editDistance, parseQuery, search } from '../src/lib/search.ts';
import type { MemoryRecord } from '../src/lib/types.ts';

function mem(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: Math.random().toString(36).slice(2),
    word: 'x',
    context: '',
    docId: 'd1',
    docTitle: 'Indian Polity Notes',
    page: 1,
    createdAt: 1,
    backend: 'walrus',
    status: 'synced',
    ...over,
  };
}

const data = [
  mem({ id: 'a', word: 'Federalism', context: 'Federalism in India is described as quasi-federal.', page: 2, createdAt: 10 }),
  mem({ id: 'b', word: 'Article 32', context: 'Article 32 gives the Right to Constitutional Remedies.', page: 3, createdAt: 20 }),
  mem({ id: 'c', word: 'Rajya Sabha', context: 'The Rajya Sabha is a permanent house.', page: 5, createdAt: 30, docTitle: 'Parliament Basics' }),
  mem({ id: 'd', word: 'அடிப்படை உரிமைகள்', context: 'அடிப்படை உரிமைகள் பற்றி', page: 6, createdAt: 40 }),
];

test('exact word match comes first', () => {
  assert.equal(search(data, 'federalism')[0].memory.id, 'a');
});

test('tanglish filler words are ignored', () => {
  assert.equal(search(data, 'antha article 32 word enna?')[0].memory.id, 'b');
});

test('typos still match (edit distance)', () => {
  assert.equal(search(data, 'federalizm')[0].memory.id, 'a');
  assert.equal(editDistance('federalism', 'federalizm', 2), 1);
});

test('page filter, in English and Tamil', () => {
  assert.deepEqual(search(data, 'what did I mark on page 5').map((h) => h.memory.id), ['c']);
  assert.deepEqual(search(data, '6 பக்கம்').map((h) => h.memory.id), ['d']);
  assert.equal(parseQuery('page 3 la enna').page, 3);
});

test('"latest" returns the newest mark', () => {
  assert.equal(search(data, 'show my latest mark')[0].memory.id, 'd');
});

test('document title matches', () => {
  assert.deepEqual(search(data, 'parliament')[0].memory.id, 'c');
});

test('Tamil words are found', () => {
  assert.equal(search(data, 'உரிமைகள்')[0].memory.id, 'd');
});

test('nothing matches -> empty', () => {
  assert.equal(search(data, 'blockchain').length, 0);
});
