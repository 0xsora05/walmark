/**
 * End-to-end check of the whole flow in a real (mobile-sized) Chromium:
 * highlight -> confirm -> save to Walrus (mock server) -> circle -> recall with title + page
 * -> PDF reading -> backup -> wipe -> restore from the stored blobs.
 *
 *   WALRUS_MODE=mock npx next start -p 3111 &
 *   BASE_URL=http://localhost:3111 node tests/e2e.cjs
 *
 * Needs Playwright with a Chromium install (npm i -D playwright && npx playwright install chromium).
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:3111';
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'walmark-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let step = 0;
const ok = (msg) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);

async function makePdf(browser) {
  const p = await browser.newPage();
  await p.setContent(`<html><body style="font-family:Arial;font-size:15pt;line-height:1.6;padding:20px">
    <h1>Constitutional Basics PDF</h1>
    <p>The Parliament of India consists of the President, the Lok Sabha and the Rajya Sabha. Federalism shapes the relationship between the Union and the States.</p>
    <p>Article 14 guarantees equality before the law to every person within the territory of India.</p>
    <div style="page-break-before:always"></div>
    <h1>Second Page</h1>
    <p>The Supreme Court protects fundamental rights through writs. Ambedkar described Article 32 as the heart and soul of the Constitution.</p>
  </body></html>`);
  const buffer = await p.pdf({ format: 'A4', printBackground: true });
  await p.close();
  return buffer;
}

async function selectText(page, rootSel, needle) {
  await page.evaluate(
    ([sel, needle]) => {
      const root = document.querySelector(sel);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(needle);
        if (i >= 0) {
          n.parentElement.scrollIntoView({ block: 'center' });
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      }
      throw new Error('needle not found: ' + needle);
    },
    [rootSel, needle],
  );
}

async function wordRect(page, rootSel, needle) {
  return page.evaluate(
    ([sel, needle]) => {
      const root = document.querySelector(sel);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(needle);
        if (i >= 0) {
          n.parentElement.scrollIntoView({ block: 'center' });
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const b = r.getBoundingClientRect();
          return { left: b.left, top: b.top, width: b.width, height: b.height };
        }
      }
      throw new Error('needle not found: ' + needle);
    },
    [rootSel, needle],
  );
}

async function circleAround(page, r, { shot } = {}) {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rx = r.width / 2 + 7;
  const ry = r.height / 2 + 10;
  await page.mouse.move(cx + rx, cy);
  await page.mouse.down();
  const N = 44;
  for (let i = 1; i <= N; i++) {
    const t = (i / N) * Math.PI * 2 * 1.05;
    await page.mouse.move(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
    if (shot && i === Math.floor(N * 0.8)) await page.screenshot({ path: path.join(SHOTS, shot) });
  }
  await page.mouse.up();
}

const dbMemories = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('walmark');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const q = req.result.transaction('memories').objectStore('memories').getAll();
          q.onsuccess = () => resolve(q.result);
        };
      }),
  );

(async () => {
  const browser = await chromium.launch();
  const pdfBuffer = await makePdf(browser);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());

  console.log('WalMark e2e against', BASE);

  /* ---------- library + sample ---------- */
  await page.goto(BASE);
  await page.getByTestId('library').waitFor();
  await page.screenshot({ path: path.join(SHOTS, '01-library.png') });
  ok('library renders');

  await page.getByTestId('load-sample').click();
  await page.getByTestId('text-page').waitFor();
  assert.match(await page.getByTestId('pager').innerText(), /6/);
  ok('sample document opens (6 pages)');

  /* ---------- highlight -> confirm -> save ---------- */
  await page.getByTestId('next-page').click(); // page 2
  await page.waitForFunction(() => document.querySelector('[data-testid=text-page]')?.textContent?.includes('Seventh Schedule'));
  await selectText(page, '[data-testid=text-page]', 'Concurrent List');
  await page.getByTestId('confirm-sheet').waitFor();
  assert.equal(await page.getByTestId('sheet-word').innerText(), 'Concurrent List');
  const sheetText = await page.getByTestId('confirm-sheet').innerText();
  assert.match(sheetText, /Indian Polity Quick Notes/);
  assert.match(sheetText, /Page 2/);
  assert.match(sheetText, /save to memory\?/i);
  await page.screenshot({ path: path.join(SHOTS, '02-highlight-confirm.png') });
  ok('highlight asks "Save to memory?" with title + page');

  await page.getByTestId('cancel-save').click();
  await page.getByTestId('confirm-sheet').waitFor({ state: 'detached' });
  assert.equal((await dbMemories(page)).length, 0);
  ok('Cancel saves nothing');

  await selectText(page, '[data-testid=text-page]', 'Concurrent List');
  await page.getByTestId('confirm-sheet').waitFor();
  await page.getByTestId('confirm-save').click();
  await page.getByTestId('toast').waitFor();
  assert.match(await page.getByTestId('toast').innerText(), /Saved “Concurrent List” to Walrus/);
  let mems = await dbMemories(page);
  assert.equal(mems.length, 1);
  assert.equal(mems[0].status, 'synced');
  assert.equal(mems[0].page, 2);
  assert.ok(mems[0].blobId);
  ok(`saved; blobId=${mems[0].blobId.slice(0, 14)}…`);

  const blob = await page.evaluate(async (id) => {
    const r = await fetch('/api/walrus/blob/' + id);
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, first: b[0], text: new TextDecoder().decode(b) };
  }, mems[0].blobId);
  assert.equal(blob.status, 200);
  assert.equal(blob.first, 1, 'blob should start with the encryption version byte');
  assert.ok(!blob.text.includes('Concurrent'), 'plaintext must not appear in the uploaded blob');
  ok('uploaded blob is AES-GCM encrypted (no plaintext leaks)');

  /* ---------- circle gesture ---------- */
  await page.getByTestId('next-page').click(); // page 3
  await page.waitForFunction(() => document.querySelector('[data-testid=text-page]')?.textContent?.includes('Ambedkar'));
  await page.getByTestId('circle-toggle').click();
  const r1 = await wordRect(page, '[data-testid=text-page]', 'Ambedkar');
  await circleAround(page, r1, { shot: '03-circle-drawing.png' });
  await page.getByTestId('confirm-sheet').waitFor();
  assert.equal(await page.getByTestId('sheet-word').innerText(), 'Ambedkar');
  assert.match(await page.getByTestId("confirm-sheet").innerText(), /circled/i);
  await page.screenshot({ path: path.join(SHOTS, '04-circle-confirm.png') });
  ok('circling a word asks to save it');

  await page.getByTestId('confirm-save').click();
  await page.waitForFunction(async () => (await new Promise((res) => { const q = indexedDB.open('walmark'); q.onsuccess = () => { const g = q.result.transaction('memories').objectStore('memories').count(); g.onsuccess = () => res(g.result); }; })) === 2);
  ok('circled word saved');

  // a sloppy tap must not save anything
  await page.mouse.click(120, 400);
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('confirm-sheet').count(), 0);
  ok('a stray tap in circle mode does nothing');
  await page.getByTestId('circle-toggle').click();

  /* ---------- recall ---------- */
  await page.getByTestId('nav-recall').click();
  await page.getByTestId('ask-input').fill('ambedkar');
  await page.getByTestId('ask-send').click();
  await page.getByTestId('memory-card').first().waitFor();
  let card = await page.getByTestId('memory-card').first().innerText();
  assert.match(card, /Ambedkar/);
  assert.match(card, /Indian Polity Quick Notes \(sample\) · Page 3/);
  await page.screenshot({ path: path.join(SHOTS, '05-recall.png') });
  ok('recall "ambedkar" -> word + title + page 3');

  await page.getByTestId('ask-input').fill('antha concurrent word enna page 2 la?');
  await page.getByTestId('ask-send').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=msg-bot]').length === 2);
  const bot2 = await page.getByTestId('msg-bot').nth(1).innerText();
  assert.match(bot2, /Concurrent List/);
  assert.match(bot2, /page 2/);
  ok('Tanglish query "antha concurrent word enna page 2 la?" works');

  await page.getByTestId('ask-input').fill('show my latest mark');
  await page.getByTestId('ask-send').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=msg-bot]').length === 3);
  assert.match(await page.getByTestId('msg-bot').nth(2).innerText(), /Ambedkar/);
  ok('"latest mark" returns the newest');

  /* ---------- open page + saved highlight painted ---------- */
  await page.getByTestId('open-page').first().click();
  await page.getByTestId('text-page').waitFor();
  await page.waitForTimeout(300);
  const painted = await page.evaluate(() => CSS.highlights?.get('wm-saved')?.size ?? -1);
  assert.equal(painted, 1);
  await page.screenshot({ path: path.join(SHOTS, '06-reader-saved-highlight.png') });
  ok('"Open page" jumps to the page and repaints the saved word');

  /* ---------- persistence ---------- */
  await page.reload();
  await page.getByTestId('nav-recall').click();
  await page.getByTestId('tab-all').click();
  await page.getByTestId('all-saved').waitFor();
  assert.equal(await page.getByTestId('memory-card').count(), 2);
  ok('memories survive a reload');

  /* ---------- PDF ---------- */
  await page.getByTestId('nav-library').click();
  await page.getByTestId('file-input').setInputFiles({ name: 'Constitutional Basics.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await page.getByTestId('reader').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=text-layer] span').length >= 4, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const ink = await page.evaluate(() => {
    const c = document.querySelector('canvas.pdf-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    return n;
  });
  assert.ok(ink > 500, 'PDF canvas should contain rendered text');
  await page.screenshot({ path: path.join(SHOTS, '07-pdf-reader.png') });
  ok(`PDF renders (canvas + selectable text layer, ${ink} dark pixels)`);

  await selectText(page, '[data-testid=text-layer]', 'Parliament');
  await page.getByTestId('confirm-sheet').waitFor();
  assert.equal(await page.getByTestId('sheet-word').innerText(), 'Parliament');
  assert.match(await page.getByTestId('confirm-sheet').innerText(), /Constitutional Basics/);
  assert.match(await page.getByTestId('confirm-sheet').innerText(), /Page 1/);
  await page.getByTestId('confirm-save').click();
  await page.getByTestId('toast').waitFor();
  ok('PDF text selection -> confirm -> saved (page 1)');

  await page.getByTestId('next-page').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=text-layer]')?.textContent?.includes('Ambedkar'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.getByTestId('circle-toggle').click();
  const r2 = await wordRect(page, '[data-testid=text-layer]', 'Ambedkar');
  await circleAround(page, r2);
  await page.getByTestId('confirm-sheet').waitFor();
  assert.equal(await page.getByTestId('sheet-word').innerText(), 'Ambedkar');
  assert.match(await page.getByTestId('confirm-sheet').innerText(), /Page 2/);
  await page.screenshot({ path: path.join(SHOTS, '08-pdf-circle-confirm.png') });
  await page.getByTestId('confirm-save').click();
  await page.getByTestId('toast').waitFor();
  ok('PDF circle gesture -> confirm -> saved (page 2)');

  await page.getByTestId('nav-recall').click();
  await page.getByTestId('ask-input').fill('parliament');
  await page.getByTestId('ask-send').click();
  await page.getByTestId('memory-card').first().waitFor();
  assert.match(await page.getByTestId('memory-card').first().innerText(), /Constitutional Basics · Page 1/);
  ok('recall from the PDF returns title + page');

  /* ---------- settings, backup, wipe, restore ---------- */
  await page.getByTestId('open-settings').click();
  await page.getByTestId('test-walrus').click();
  await page.getByTestId('health-result').waitFor();
  assert.match(await page.getByTestId('health-result').innerText(), /working|reachable/);
  await page.screenshot({ path: path.join(SHOTS, '09-settings.png') });
  ok('settings: connection test passes');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
  const backupPath = path.join(SHOTS, 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.refs.length, 4);
  assert.ok(backup.key && backup.key.length >= 40);
  ok('backup exported (4 blob references + key)');

  await page.getByRole('button', { name: 'Erase everything on this device' }).click();
  await page.waitForFunction(async () => (await new Promise((res) => { const q = indexedDB.open('walmark'); q.onsuccess = () => { const g = q.result.transaction('memories').objectStore('memories').count(); g.onsuccess = () => res(g.result); }; })) === 0);
  ok('device wiped');

  await page.getByTestId('open-settings').click();
  await page.locator('[data-testid=settings] input[type=file]').setInputFiles(backupPath);
  // poll from Node: waiting inside the page on an async IndexedDB read is easy to get subtly wrong
  const deadline = Date.now() + 20000;
  while ((await dbMemories(page)).length < 4 && Date.now() < deadline) await page.waitForTimeout(200);
  mems = await dbMemories(page);
  const words = mems.map((m) => m.word).sort();
  assert.deepEqual(words, ['Ambedkar', 'Ambedkar', 'Concurrent List', 'Parliament']);
  assert.ok(mems.every((m) => m.docTitle && m.page));
  ok('restored from Walrus blobs: all 4 words back with title + page, decrypted with the backed-up key');

  assert.deepEqual(errors.filter((e) => !/favicon|manifest|sw\.js/.test(e)), [], 'no browser errors');
  ok('no console or page errors');

  await browser.close();
  console.log(`\nAll ${step} checks passed. Screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
