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

    // The recipient usually arrives prefilled from ?to=; set it if not, or if
    // it somehow belongs to someone else.
    const rec = pick(S.dmRecipients, form);
    if (rec && author && !rec.value.toLowerCase().includes(String(author).toLowerCase())) {
      setInput(rec, author);
    }

    // The subject is ALWAYS overwritten, never left alone because something is
    // already in the box.
    //
    // XenForo saves a draft of a conversation you started and did not send, and
    // restores it - title and all - the next time you open the compose page. The
    // old code only set the subject when the field was empty, so every PM after
    // the first went out under the first one's title: a message about Indonesian
    // .id links sitting under "INDIA --- Looking to Hire Best And Expert BLACK
    // HAT SEO SPECIALIST". We opened this page for this lead, so this lead's
    // title is the right one, whatever the forum restored.
    const subject = pick(S.dmTitle, form);
    if (subject && title) setInput(subject, title);

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
    if (title && subject.value.trim() !== String(title).trim()) {
      return { ok: false, error: `the subject did not take - it still says "${subject.value.trim().slice(0, 60)}"` };
    }

    if (mode !== 'send') return { ok: true, filled: true, refilled: hold.held() };

    const btn = pick(S.dmSubmit, form);
    if (!btn) return { ok: false, error: 'no send button on the DM form' };
    btn.click();

    // Landing on the conversation is the clearest confirmation, but it is not
    // the only shape a success takes: the form can be submitted over XHR and
    // leave the address bar alone, and a slow forum can take longer than this
    // loop is willing to wait. So a few other signs count, and running out of
    // patience is reported as "probably sent" rather than as a failure - the
    // caller then asks BHW's own message list, which is the only real
    // authority. Saying "could not send" about a PM that did go is the worse
    // mistake: it leaves the row unstruck and invites you to send it twice.
    const left = location.href;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (/\/direct-messages\/(?!add)|\/conversations\/(?!add)/.test(location.pathname)) {
        return { ok: true, sent: true, dmUrl: location.href };
      }
      const err = document.querySelector('.blockMessage--error, .js-errorMessage');
      if (err && err.textContent.trim()) return { ok: false, error: err.textContent.trim().slice(0, 200) };
      // XenForo's own success notice, whether or not the page moved.
      const good = document.querySelector('.blockMessage--success, .js-successMessage');
      if (good && good.textContent.trim()) return { ok: true, sent: true, dmUrl: location.href };
      // The compose form is gone and the conversation is on the page: that is
      // the conversation view, rendered without a navigation. S.dmSent exists
      // for exactly this and was only used on one of the two paths.
      if (!pick(S.dmForm) && pick(S.dmSent)) {
        return { ok: true, sent: true, dmUrl: location.href };
      }
    }
    return { ok: true, sent: false, unconfirmed: true, movedTo: location.href !== left ? location.href : '',
             error: 'submitted, but the page never confirmed it within 20s' };
  }

  run()
    .catch((e) => ({ ok: false, error: `dm script: ${e && e.message ? e.message : String(e)}` }))
    .then((result) => chrome.runtime.sendMessage({ type: 'haf-dm-result', threadId, result }));
})();
