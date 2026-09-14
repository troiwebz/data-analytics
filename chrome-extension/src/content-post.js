/* Runs inside a BlackHatWorld thread page. Injected by the service worker
 * together with selectors.js, after __HAF_DRAFT__ has been set.
 * Reports back over chrome.runtime.sendMessage — more reliable than relying
 * on executeScript's completion value for an async script. */
(function () {
  const S = globalThis.HAF_SELECTORS;
  const draft = globalThis.__HAF_DRAFT__;
  const dryRun = globalThis.__HAF_DRY_RUN__ === true;
  const threadId = globalThis.__HAF_THREAD_ID__;

  const pick = (list, root = document) => {
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    // Hidden inputs legitimately have no layout box, so try again without the check.
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, ...types) => {
    for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
  };

  async function run() {
    if (!draft || !draft.trim()) return { ok: false, error: 'empty draft' };
    if (/\/login\b|\/register\b/.test(location.pathname)) {
      return { ok: false, error: 'not logged in to BlackHatWorld' };
    }

    const form = pick(S.form);
    if (!form) {
      const blocked = pick(S.blocked);
      return {
        ok: false,
        error: blocked
          ? `no reply form — ${blocked.textContent.trim().slice(0, 120)}`
          : 'no quick-reply form on this page (thread locked, or not logged in)'
      };
    }

    // --- put the text in the editor ------------------------------------
    const rich = pick(S.richEditor, form);
    const plain = pick(S.plainTextarea, form);
    const html = draft
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
      .join('');

    if (rich) {
      rich.focus();
      rich.innerHTML = html;
      // Froala/XenForo listen for these; without them the hidden field stays empty.
      fire(rich, 'input', 'keyup', 'change', 'blur');
      const hidden = pick(S.hiddenInput, form);
      if (hidden) { hidden.value = html; fire(hidden, 'input', 'change'); }
    } else if (plain) {
      plain.focus();
      plain.value = draft;
      fire(plain, 'input', 'keyup', 'change');
    } else {
      return { ok: false, error: 'found the form but no editor inside it' };
    }

    await sleep(700); // let the editor sync its hidden field

    const landed = (rich && rich.textContent.trim().length > 20) ||
                   (plain && plain.value.trim().length > 20);
    if (!landed) return { ok: false, error: 'text did not stick in the editor' };

    if (dryRun) return { ok: true, dryRun: true, note: 'draft inserted, not submitted' };

    const msgSel = S.message.join(',');
    const before = document.querySelectorAll(msgSel).length;
    const btn = pick(S.submit, form);
    if (!btn) return { ok: false, error: 'no submit button found' };
    btn.click();

    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const posts = document.querySelectorAll(msgSel);
      if (posts.length > before) {
        const last = posts[posts.length - 1];
        return { ok: true, postUrl: last.querySelector('a[href*="/post-"]')?.href || location.href };
      }
      const err = document.querySelector('.blockMessage--error, .js-errorMessage');
      if (err && err.textContent.trim()) {
        return { ok: false, error: err.textContent.trim().slice(0, 200) };
      }
    }
    return { ok: false, error: 'submitted but no confirmation after 15s — check the thread manually' };
  }

  run()
    .catch((e) => ({ ok: false, error: `content script: ${e && e.message ? e.message : String(e)}` }))
    .then((result) => chrome.runtime.sendMessage({ type: 'haf-post-result', threadId, result }));
})();
