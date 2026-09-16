/* Shared helpers for the content scripts. Injected before them, so it must be
 * a plain script, not a module. */

/**
 * Plain text -> HTML for XenForo's editor.
 *
 * A blank line in the source must survive as a blank line in the editor.
 * Wrapping each paragraph in <p> is not enough - the editor collapses the
 * margins and everything runs together - so an explicit empty paragraph goes
 * between them.
 *
 * **double asterisks** become bold. The draft is stored with the markers, which
 * is what the dashboard and Telegram strip for copying; only the text typed
 * into the editor gets the real <strong>.
 */
globalThis.HAF_HTML = function (text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('<p><br></p>');
};

/**
 * Put the draft in the editor and make it stay there.
 *
 * Writing `editor.innerHTML` fires no events whatsoever. XenForo ships Froala,
 * which keeps its own copy of the content and updates that copy from edit
 * events - so a raw innerHTML write is invisible to it. The text appears, then
 * the editor's next housekeeping pass writes its own (empty) copy back over the
 * element and the reply vanishes a second later. That is the disappearing act.
 *
 * So the text goes in through the browser's own editing pipeline instead:
 * select everything, then execCommand('insertHTML'), which raises a real
 * trusted `input` event the editor is already listening for. As far as it can
 * tell, the text was typed.
 *
 * Two further rules, both learned from the same bug:
 *
 *   - Never fire a synthetic `blur`. That is the event that triggers the
 *     write-back, and the old code fired it deliberately.
 *   - Trust nothing. Some themes re-initialise the editor a beat after the
 *     page settles, which wipes it however the text got in. So the text is
 *     held: if it disappears within the next few seconds it goes straight back.
 *     The hold stands down the instant you do anything yourself - a keystroke,
 *     a paste, or a click on any button - so it can never fight you for the
 *     box, undo a deletion you meant, or type the draft back in after you have
 *     pressed Post reply and the forum has cleared the editor. Only trusted
 *     events count, and ours are never trusted.
 */
/**
 * Plain text -> BB code, for when the rich editor is switched off in
 * preferences and the reply goes into a raw textarea.
 *
 * **double asterisks** are our own marker, not markup BHW understands. In the
 * rich editor they become real <strong>; here they have to become [B]...[/B],
 * or the heading posts with the asterisks showing.
 */
globalThis.HAF_BBCODE = function (text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '[B]$1[/B]');
};

globalThis.HAF_FILL = function (rich, plain, text, opts) {
  const o = opts || {};
  const holdMs = o.holdMs == null ? 12000 : o.holdMs;
  const html = globalThis.HAF_HTML(text);
  const body = String(text || '');
  const fire = (el, ...types) => { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); };

  // Whitespace differs between what we typed and what the editor renders, so
  // compare on a flattened version, and check both ends: a wipe that takes
  // only the top is still a wipe.
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const want = flat(body.replace(/\*\*/g, ''));
  const head = want.slice(0, 24), tail = want.slice(-24);
  const present = () => {
    const got = flat(rich ? rich.textContent : plain && plain.value);
    return !!head && got.includes(head) && got.includes(tail);
  };

  function put(keepFocus) {
    if (plain && !rich) {
      plain.focus();
      plain.value = globalThis.HAF_BBCODE(body);
      fire(plain, 'input', 'keyup', 'change');
      return true;
    }
    if (!rich) return false;

    const doc = rich.ownerDocument;
    const win = doc.defaultView;
    const was = doc.activeElement;
    let done = false;
    try {
      rich.focus();
      const sel = win.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(rich);          // replace what is there, don't append
      sel.removeAllRanges();
      sel.addRange(range);
      done = doc.execCommand('insertHTML', false, html);
    } catch (e) { done = false; }

    // execCommand can be refused (an editor that blocks it, a document that
    // cannot take the selection). A raw write is worse but better than nothing,
    // and the hold below is what makes it stick either way.
    if (!done || !present()) {
      rich.innerHTML = html;
      fire(rich, 'input', 'keyup', 'change');   // note: no blur
    }

    // XenForo posts the hidden field, and syncs it from the editor itself. Set
    // it too, so the reply survives a submit even if that sync never runs.
    const hidden = o.hidden;
    if (hidden) { hidden.value = html; fire(hidden, 'input', 'change'); }

    if (keepFocus && was && was !== rich) { try { was.focus(); } catch (e) { /* gone */ } }
    return present();
  }

  const ok = put();

  // Hold it. Anything you do yourself ends the hold immediately - the events
  // are trusted, ours are not, so this cannot mistake one for the other.
  let held = 0;
  let stop = () => {};
  if (holdMs > 0 && (rich || plain)) {
    const target = rich || plain;
    const doc = target.ownerDocument;
    const EDITS = ['keydown', 'paste', 'cut', 'drop'];
    let timer = null;
    stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      for (const t of EDITS) target.removeEventListener(t, onEdit, true);
      doc.removeEventListener('click', onClick, true);
    };
    function onEdit(e) { if (e.isTrusted) stop(); }
    // Pressing Post reply is a click, not a keystroke, and the forum clears the
    // editor right after it. Without this the hold would type the draft back in
    // on top of the reply you just posted.
    function onClick(e) {
      if (!e.isTrusted) return;
      const el = e.target && e.target.closest && e.target.closest('button, input[type="submit"], a.button');
      if (el) stop();
    }
    for (const t of EDITS) target.addEventListener(t, onEdit, true);
    doc.addEventListener('click', onClick, true);

    const until = Date.now() + holdMs;
    timer = setInterval(() => {
      if (Date.now() > until || !target.isConnected) return stop();
      if (present()) return;
      held++;
      put(true);          // a re-fill must not steal the caret back
    }, 400);
  }

  return { ok, held: () => held, stop: () => stop() };
};
