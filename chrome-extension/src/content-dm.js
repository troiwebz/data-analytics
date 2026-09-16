/* Runs on BlackHatWorld's direct-message compose page. Injected by the
 * service worker after the __HAF_DM_* globals are set.
 *
 *   __HAF_DM_MODE__ = 'fill'  fill recipient, subject and body, do NOT send
 *                     'send'  fill, then submit
 *
 * Reports back over chrome.runtime.sendMessage. */
(function () {
  const S = globalThis.HAF_SELECTORS;
  const { author, title, body } = globalThis.__HAF_DM__ || {};
  const mode = globalThis.__HAF_DM_MODE__ || 'fill';
  const threadId = globalThis.__HAF_THREAD_ID__;

  const pick = (list, root = document) => {
    for (const sel of list) { const el = root.querySelector(sel); if (el && el.offsetParent !== null) return el; }
    for (const sel of list) { const el = root.querySelector(sel); if (el) return el; }
    return null;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, ...types) => { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); };

  function setInput(el, value) {
    if (!el) return false;
    el.focus();
    el.value = value;
    fire(el, 'input', 'keyup', 'change');
    return true;
  }

  async function run() {
    if (/\/login\b|\/register\b/.test(location.pathname)) {
      return { ok: false, error: 'not logged in to BlackHatWorld' };
    }
    const form = pick(S.dmForm);
    if (!form) {
      const blocked = pick(S.blocked);
      return { ok: false, error: blocked
        ? `cannot open a DM — ${blocked.textContent.trim().slice(0, 140)}`
        : 'no direct-message form on this page (DMs disabled, or not logged in)' };
    }

    // The recipient usually arrives prefilled from ?to=; set it if not.
    const rec = pick(S.dmRecipients, form);
    if (rec && !rec.value.trim() && author) setInput(rec, author);

    const subject = pick(S.dmTitle, form);
    if (subject && !subject.value.trim()) setInput(subject, title || '');

    // Body: same editor as a thread reply.
    const rich = pick(S.richEditor, form);
    const plain = pick(S.plainTextarea, form);

    if (!rich && !plain) return { ok: false, error: 'found the DM form but no editor inside it' };

    // Same editor as a thread reply, so the same disappearing act - and the
    // same cure. See HAF_FILL in content-lib.js.
    const hold = globalThis.HAF_FILL(rich, plain, body, {
      hidden: pick(S.hiddenInput, form),
      holdMs: mode === 'send' ? 3000 : 12000
    });

    await sleep(700);
    const landed = (rich && rich.textContent.trim().length > 20) || (plain && plain.value.trim().length > 20);
    if (!landed) return { ok: false, error: 'text did not stick in the DM editor' };
    if (!subject || !subject.value.trim()) return { ok: false, error: 'DM needs a subject and none was set' };

    if (mode !== 'send') return { ok: true, filled: true, refilled: hold.held() };

    const btn = pick(S.dmSubmit, form);
    if (!btn) return { ok: false, error: 'no send button on the DM form' };
    btn.click();

    for (let i = 0; i < 30; i++) {
      await sleep(500);
      // A sent DM lands on the conversation itself.
      if (/\/direct-messages\/(?!add)|\/conversations\/(?!add)/.test(location.pathname)) {
        return { ok: true, sent: true, dmUrl: location.href };
      }
      const err = document.querySelector('.blockMessage--error, .js-errorMessage');
      if (err && err.textContent.trim()) return { ok: false, error: err.textContent.trim().slice(0, 200) };
    }
    return { ok: false, error: 'sent but no confirmation after 15s — check your DMs' };
  }

  run()
    .catch((e) => ({ ok: false, error: `dm script: ${e && e.message ? e.message : String(e)}` }))
    .then((result) => chrome.runtime.sendMessage({ type: 'haf-dm-result', threadId, result }));
})();
