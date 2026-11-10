import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLearnText, parseLearnText, parseMemwalText, formatMemwalText } from '../src/lib/memwalFormat.ts';
import { learnableTerms, search } from '../src/lib/search.ts';
import { parseAccountObject } from '../src/lib/server/sui-util.ts';
import type { LearnPayload, MemoryRecord } from '../src/lib/types.ts';

function mem(over: Partial<MemoryRecord>): MemoryRecord {
  return { id: 'm1', word: 'mutex', context: 'A mutex guards shared state.', docId: 'd', docTitle: 'Concurrency Notes', page: 2, createdAt: 1, backend: 'memwal', status: 'synced', ...over };
}

test('a nickname you confirmed finds the mark even though the words never appear in it', () => {
  const m = mem({});
  assert.equal(search([m], 'lock thing').length, 0);
  const taught = { ...m, aliases: ['lock', 'thing'] };
  const hits = search([taught], 'lock thing');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memory.id, 'm1');
});

test('marks you keep confirming rank above equally good ones, and the boost is capped', () => {
  const a = mem({ id: 'a', word: 'channel', context: 'A channel passes values.' });
  const b = mem({ id: 'b', word: 'channel', context: 'A channel passes values.', confirmed: 3 });
  assert.equal(search([a, b], 'channel')[0].memory.id, 'b');
  const huge = mem({ id: 'c', word: 'channel', confirmed: 1000 });
  const base = mem({ id: 'd', word: 'channel', confirmed: 5 });
  const hs = search([huge, base], 'channel');
  assert.equal(hs[0].score, hs[1].score);
});

test('"Not it" demotes a mark for those words but does not hide it', () => {
  const wrong = mem({ id: 'w', word: 'lock', context: 'lock', avoid: ['lock'] });
  const right = mem({ id: 'r', word: 'lock', context: 'lock' });
  const hits = search([wrong, right], 'lock');
  assert.equal(hits[0].memory.id, 'r');
  assert.equal(hits.length, 2);
});

test('only meaningful words of a question are learned', () => {
  assert.deepEqual(learnableTerms('antha lock thing word enna page 2 la?'), ['lock', 'thing']);
  assert.deepEqual(learnableTerms('what did I mark'), []);
});

test('lessons round-trip through Walrus Memory text and never look like a mark', () => {
  const lesson: LearnPayload = { v: 1, app: 'walmark', kind: 'alias', memoryId: 'm1', word: 'mutex', docTitle: 'Concurrency Notes', page: 2, terms: ['lock', 'thing'], at: 5 };
  const text = formatLearnText(lesson);
  assert.match(text, /Learned: when I ask “lock”, “thing”, I mean “mutex”/);
  assert.deepEqual(parseLearnText(text), lesson);
  assert.equal(parseMemwalText(text), null);
  const markText = formatMemwalText(mem({}));
  assert.equal(parseLearnText(markText), null);
  assert.equal(parseMemwalText(markText)?.word, 'mutex');
  assert.match(formatLearnText({ ...lesson, kind: 'avoid' }), /do NOT mean/);
});

test('broken or foreign lesson lines are ignored', () => {
  assert.equal(parseLearnText('hello'), null);
  assert.equal(parseLearnText('#walmark-learn {not json'), null);
  assert.equal(parseLearnText('#walmark-learn {"app":"other","kind":"alias","memoryId":"x","terms":[]}'), null);
});

test('the MemWal account object is summarised from a Sui getObject response', () => {
  assert.equal(parseAccountObject({ error: { code: 'notExists' } }).exists, false);
  const a = parseAccountObject({
    data: { type: '0xabc123::account::MemWalAccount', version: '77', owner: { Shared: { initial_shared_version: 1 } }, content: { fields: { delegate_keys: [{}, {}] } } },
  });
  assert.equal(a.exists, true);
  assert.equal(a.type, 'account::MemWalAccount');
  assert.equal(a.version, '77');
  assert.equal(a.owner, 'shared object');
  assert.equal(a.delegateKeys, 2);
  const owned = parseAccountObject({ data: { type: '0x1::x::Y', owner: { AddressOwner: '0xme' }, content: { fields: { delegate_keys: { fields: { contents: [1, 2, 3] } } } } } });
  assert.equal(owned.owner, '0xme');
  assert.equal(owned.delegateKeys, 3);
});
