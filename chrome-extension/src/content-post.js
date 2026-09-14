/* Runs inside a BlackHatWorld thread page. Injected by the service worker
 * together with selectors.js, after the __HAF_* globals have been set.
 *
 *   __HAF_MODE__ = 'full'    insert the reply and submit it
 *                  'stage'   insert the reply, do NOT submit (tab stays open, armed)
 *                  'submit'  the reply is already in the editor — just submit it
 *
 * Reports back over chrome.runtime.sendMessage — more reliable than relying
 * on executeScript's completion value for an async script. */
(function () {
  const S = globalThis.HAF_SELECTORS;
  const draft = globalThis.__HAF_DRAFT__;
  const mode = globalThis.__HAF_MODE__ || 'full';
  const threadId = globalThis.__HAF_THREAD_ID__;

  const pick = (list, root = document) => {
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    for (const sel of list) {           // hidden inputs have no layout box
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, ...types) => {
    for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
  };

  function insert(form) {
    const rich = pick(S.richEditor, form);
    const plain = pick(S.plainTextarea, form);
    const html = draft
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
      .join('');

    if (rich) {
      rich.focus();
      rich.innerHTML = html;
      fire(rich, 'input', 'keyup', 'change', 'blur');   // XenForo syncs its hidden field on these
      const hidden = pick(S.hiddenInput, form);
      if (hidden) { hidden.value = html; fire(hidden, 'input', 'change'); }
    } else if (plain) {
      plain.focus();
      plain.value = draft;
      fire(plain, 'input', 'keyup', 'change');
    } else {
      return 'found the form but no editor inside it';
    }
    return null;
  }

  function editorHasText(form) {
    const rich = pick(S.richEditor, form);
    const plain = pick(S.plainTextarea, form);
    return (rich && rich.textContent.trim().length > 20) ||
           (plain && plain.value.trim().length > 20);
  }

  async function submit(form) {
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
      if (err && err.textContent.trim()) return { ok: false, error: err.textContent.trim().slice(0, 200) };
    }
    return { ok: false, error: 'submitted but no confirmation after 15s — check the thread manually' };
  }

  async function run() {
    if (/\/login\b|\/register\b/.test(location.pathname)) {
      return { ok: false, error: 'not logged in to BlackHatWorld' };
    }
    const form = pick(S.form);
    if (!form) {
      const blocked = pick(S.blocked);
      return { ok: false, error: blocked
        ? `no reply form — ${blocked.textContent.trim().slice(0, 120)}`
        : 'no quick-reply form on this page (thread locked, or not logged in)' };
    }

    if (mode !== 'submit') {
      if (!draft || !draft.trim()) return { ok: false, error: 'empty draft' };
      const err = insert(form);
      if (err) return { ok: false, error: err };
      await sleep(700);
      if (!editorHasText(form)) return { ok: false, error: 'text did not stick in the editor' };
      if (mode === 'stage') return { ok: true, staged: true };
    } else if (!editorHasText(form)) {
      return { ok: false, error: 'staged reply is gone from the editor (page reloaded?)' };
    }

    return submit(form);
  }

  run()
    .catch((e) => ({ ok: false, error: `content script: ${e && e.message ? e.message : String(e)}` }))
    .then((result) => chrome.runtime.sendMessage({ type: 'haf-post-result', threadId, mode, result }));
})();
