import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeStroke, pointInPolygon, type Pt } from '../src/lib/circle.ts';
import { paginate } from '../src/lib/paginate.ts';

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 40, closeGap = 0): Pt[] {
  const pts: Pt[] = [];
  const end = Math.PI * 2 * (1 - closeGap);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * end;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pts;
}

test('a closed loop is accepted, including a flat ellipse around one word', () => {
  assert.equal(analyzeStroke(ellipse(100, 100, 60, 30)).ok, true);
  assert.equal(analyzeStroke(ellipse(100, 100, 50, 18)).ok, true);
});

test('a slightly sloppy loop (small gap) is accepted', () => {
  assert.equal(analyzeStroke(ellipse(100, 100, 60, 40, 40, 0.06)).ok, true);
});

test('an open arc is rejected', () => {
  const v = analyzeStroke(ellipse(100, 100, 60, 40, 40, 0.5));
  assert.equal(v.ok, false);
});

test('taps and tiny scribbles are rejected', () => {
  assert.equal(analyzeStroke([{ x: 1, y: 1 }]).ok, false);
  assert.equal(analyzeStroke(ellipse(10, 10, 4, 4)).ok, false);
});

test('point in polygon', () => {
  const poly = ellipse(100, 100, 60, 30);
  assert.equal(pointInPolygon({ x: 100, y: 100 }, poly), true);
  assert.equal(pointInPolygon({ x: 100, y: 160 }, poly), false);
  assert.equal(pointInPolygon({ x: 170, y: 100 }, poly), false);
});

test('paginate: form feeds, paragraphs and long text', () => {
  assert.deepEqual(paginate('one\fTwo\fthree'), ['one', 'Two', 'three']);
  assert.equal(paginate('short text').length, 1);
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(60)).join('\n\n');
  const pages = paginate(long, 1600);
  assert.ok(pages.length > 3);
  assert.ok(pages.every((p) => p.length < 2400));
  assert.deepEqual(paginate('   '), ['']);
});

test('sentenceAround does not cut at initials or abbreviations', async () => {
  const { sentenceAround } = await import('../src/lib/text.ts');
  const text = 'Earlier line ends here. Dr. B. R. Ambedkar called it the heart and soul of the Constitution. Next one starts.';
  const i = text.indexOf('Ambedkar');
  assert.equal(
    sentenceAround(text, i, i + 'Ambedkar'.length),
    'Dr. B. R. Ambedkar called it the heart and soul of the Constitution.',
  );
  const t2 = 'First sentence. Second has the word Federalism in it! Third.';
  const j = t2.indexOf('Federalism');
  assert.equal(sentenceAround(t2, j, j + 10), 'Second has the word Federalism in it!');
});
