// "Open filled" — the reply has to still be there a few seconds later.
//
// The bug: the filler set `editor.innerHTML` directly. That fires no events at
// all (proved below), so an editor that keeps its own copy of the content -
// XenForo ships Froala, which does - never learns the text arrived. Its next
// housekeeping pass writes its own copy back over the element and the reply
// vanishes a moment after it appears, which is exactly what you see on screen.
// The old code then made it worse by firing a synthetic `blur`, which is the
// event that triggers that pass.
//
// jsdom cannot judge this: it has no editing pipeline, so execCommand and a
// raw innerHTML write look identical there. This runs in real Chromium against
// the extension's real content scripts, on a stand-in for BHW's quick reply
// that behaves the way a model-backed editor behaves.
//
// Skipped when playwright-core is not installed, like the other real-browser
// suites.
import { readFileSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('  SKIP  playwright-core not installed'); process.exit(0); }

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SRC = new URL('../src/', import.meta.url).pathname;
const read = (f) => readFileSync(SRC + f, 'utf8');

let failed = 0;
const ok = (what, pass, saw = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${what}${pass ? '' : `  ${saw}`}`);
  if (!pass) failed++;
};

const DRAFT = 'Hi @sample_buyer,\n\n**Why We Can Do It:**\n\nManual submissions to directories that '
            + 'actually index in Dubai/UAE and the UK, not a blast list.\n\nDropped you a PM.';

// A stand-in for BHW's quick reply. The editor keeps its own copy of the
// content and updates it only from trusted `input` events - which is how a
// real rich editor works, and why a raw innerHTML write is invisible to it.
// `wipeOn` picks which housekeeping pass writes that copy back:
//   'blur'  a debounced sync after the editor loses focus  (Froala's own)
//   'init'  a late initialisation that resets from the hidden field
// Both are real behaviours, and the fill has to survive either.
const page = (wipeOn) => `<!doctype html><meta charset="utf-8">
<form class="js-quickReply" action="/post-reply">
  <div class="fr-box">
    <div class="fr-element fr-view" contenteditable="true"></div>
  </div>
  <textarea class="js-editorInput" name="message_html" style="display:none"></textarea>
  <button type="submit" class="button--icon--reply">Post reply</button>
</form>
<script>
(function () {
  const el = document.querySelector('.fr-element');
  const hidden = document.querySelector('.js-editorInput');
  let model = '';                                  // the editor's own copy
  window.__model = () => model;

  // Only a trusted edit updates the model. An innerHTML write is invisible.
  el.addEventListener('input', (e) => { if (e.isTrusted) { model = el.innerHTML; hidden.value = model; } });

  const restore = () => { el.innerHTML = model; hidden.value = model; };
  const mode = ${JSON.stringify(wipeOn)};
  if (mode === 'blur') el.addEventListener('blur', () => setTimeout(restore, 1200));
  else if (mode === 'init') setTimeout(restore, 1400);   // a late init, resetting from its copy
  // 'none': a well-behaved editor, for testing what happens around a real post
})();
</script>`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// The service worker sets the globals, then injects the three files in order.
async function fill(wipeOn) {
  const p = await browser.newPage();
  await p.setContent(page(wipeOn));
  await p.evaluate(() => { window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => window.__sent.push(m) } }; });
  await p.evaluate(({ draft }) => {
    globalThis.__HAF_DRAFT__ = draft; globalThis.__HAF_MODE__ = 'stage'; globalThis.__HAF_THREAD_ID__ = '9001';
  }, { draft: DRAFT });
  for (const f of ['selectors.js', 'content-lib.js', 'content-post.js']) await p.evaluate(read(f));
  await p.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });
  const reported = await p.evaluate(() => window.__sent[0].result);
  await p.waitForTimeout(4000);                     // long enough for either wipe to land
  const state = await p.evaluate(() => ({
    text: document.querySelector('.fr-element').textContent.trim(),
    model: window.__model(),
    hidden: document.querySelector('.js-editorInput').value
  }));
  await p.close();
  return { reported, ...state };
}

for (const wipeOn of ['blur', 'init']) {
  const r = await fill(wipeOn);
  const where = `(${wipeOn} wipe)`;
  ok(`the fill reports success ${where}`, r.reported?.ok === true && r.reported?.staged === true, JSON.stringify(r.reported));
  ok(`the reply is still in the editor 4s later ${where}`, r.text.includes('Dropped you a PM'), JSON.stringify(r.text.slice(0, 70)));
  ok(`the whole reply is there, not half of it ${where}`, r.text.includes('sample_buyer') && r.text.includes('blast list'), JSON.stringify(r.text.slice(0, 70)));
  ok(`the editor's own copy has it too, so a submit would carry it ${where}`, /Dropped you a PM/.test(r.model), JSON.stringify(r.model.slice(0, 70)));
  ok(`the hidden field the form posts has it ${where}`, /Dropped you a PM/.test(r.hidden), JSON.stringify(r.hidden.slice(0, 70)));
  ok(`bold markers became real bold, not literal asterisks ${where}`, !r.text.includes('**'), JSON.stringify(r.text.slice(0, 70)));
  ok(`the blank lines survived as separate paragraphs ${where}`, (r.model.match(/<p/g) || []).length >= 3, r.model.slice(0, 70));
}

// The hold must never fight you. Type in the box and it stands down for good,
// so a deletion you meant stays deleted.
{
  const p = await browser.newPage();
  await p.setContent(page('blur'));
  await p.evaluate(() => { window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => window.__sent.push(m) } }; });
  await p.evaluate(({ draft }) => {
    globalThis.__HAF_DRAFT__ = draft; globalThis.__HAF_MODE__ = 'stage'; globalThis.__HAF_THREAD_ID__ = '9001';
  }, { draft: DRAFT });
  for (const f of ['selectors.js', 'content-lib.js', 'content-post.js']) await p.evaluate(read(f));
  await p.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });

  // A real keystroke, then a real clear - the way you would rewrite it yourself.
  await p.click('.fr-element');
  await p.keyboard.press('a');
  await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => document.querySelector('.fr-element').textContent.trim());
  ok('clearing it yourself sticks - the hold does not put it back', after === '', JSON.stringify(after.slice(0, 50)));
  await p.close();
}

// Pressing Post reply clears the editor - that is the forum accepting the
// reply, not a wipe. The hold must stand down rather than type the draft back
// in on top of a reply you have just posted. A click, note, not a keystroke.
{
  const p = await browser.newPage();
  await p.setContent(page('none') + `<script>
    // What XenForo does on a successful quick reply: add the post, clear the box.
    document.querySelector('button[type=submit]').addEventListener('click', (ev) => {
      ev.preventDefault();                          // XenForo posts over AJAX
      const a = document.createElement('article'); a.className = 'message';
      a.innerHTML = '<a href="/threads/x.1/post-77">#77</a>';
      document.body.appendChild(a);
      document.querySelector('.fr-element').innerHTML = '';
    });
  </script>`);
  await p.evaluate(() => { window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => window.__sent.push(m) } }; });
  await p.evaluate(({ draft }) => {
    globalThis.__HAF_DRAFT__ = draft; globalThis.__HAF_MODE__ = 'stage'; globalThis.__HAF_THREAD_ID__ = '9001';
  }, { draft: DRAFT });
  for (const f of ['selectors.js', 'content-lib.js', 'content-post.js']) await p.evaluate(read(f));
  await p.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });

  await p.click('button[type=submit]');
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => document.querySelector('.fr-element').textContent.trim());
  ok('posting it clears the box and the hold leaves it cleared', after === '', JSON.stringify(after.slice(0, 60)));
  const landed = await p.evaluate(() => window.__sent.find((m) => m.cmd === 'reply-landed'));
  ok('and the reply landing is reported, so the row can turn green', !!landed, JSON.stringify(landed));
  ok('with the real post link', /\/post-77$/.test(landed?.postUrl || ''), landed?.postUrl);
  await p.close();
}

// The BB-code editor, for when the rich one is switched off in preferences.
{
  const p = await browser.newPage();
  await p.setContent(`<form class="js-quickReply" action="/post-reply">
    <textarea name="message"></textarea><button type="submit">Post reply</button></form>`);
  await p.evaluate(() => { window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => window.__sent.push(m) } }; });
  await p.evaluate(({ draft }) => {
    globalThis.__HAF_DRAFT__ = draft; globalThis.__HAF_MODE__ = 'stage'; globalThis.__HAF_THREAD_ID__ = '9001';
  }, { draft: DRAFT });
  for (const f of ['selectors.js', 'content-lib.js', 'content-post.js']) await p.evaluate(read(f));
  await p.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });
  await p.waitForTimeout(2000);
  const v = await p.evaluate(() => document.querySelector('textarea[name="message"]').value);
  ok('the plain editor gets the reply', v.includes('Dropped you a PM'), JSON.stringify(v.slice(0, 50)));
  ok('and our bold markers become BB code, not literal asterisks',
     v.includes('[B]Why We Can Do It:[/B]') && !v.includes('**'), JSON.stringify(v.slice(0, 60)));
  await p.close();
}

// The PM compose page uses the same editor, so it had the same bug.
{
  const p = await browser.newPage();
  await p.setContent(page('blur').replace('<form class="js-quickReply" action="/post-reply">',
    '<form action="/direct-messages/insert"><input name="recipients"><input name="title">'));
  await p.evaluate(() => { window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => window.__sent.push(m) } }; });
  await p.evaluate(({ draft }) => {
    globalThis.__HAF_DM__ = { author: 'sample_buyer', title: 'Re: citations', body: draft };
    globalThis.__HAF_DM_MODE__ = 'fill'; globalThis.__HAF_THREAD_ID__ = '9001';
  }, { draft: DRAFT });
  for (const f of ['selectors.js', 'content-lib.js', 'content-dm.js']) await p.evaluate(read(f));
  await p.waitForFunction(() => window.__sent.length > 0, null, { timeout: 15000 });
  const reported = await p.evaluate(() => window.__sent[0].result);
  await p.waitForTimeout(4000);
  const st = await p.evaluate(() => ({
    text: document.querySelector('.fr-element').textContent.trim(),
    to: document.querySelector('input[name="recipients"]').value,
    subject: document.querySelector('input[name="title"]').value
  }));
  ok('the PM fill reports success', reported?.ok === true && reported?.filled === true, JSON.stringify(reported));
  ok('the PM body is still there 4s later', st.text.includes('Dropped you a PM'), JSON.stringify(st.text.slice(0, 50)));
  ok('the recipient is set', st.to === 'sample_buyer', st.to);
  ok('the subject is set', st.subject === 'Re: citations', st.subject);
  await p.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);
