// v2-submit.js — runs on Reddit's own submit page. Fills the title and the
// body of whatever the Growth Board scheduled for today, then gets out of
// the way: you read it and press Reddit's Post button yourself.
//
// A comment posted to the wrong room costs a downvote. A post to the wrong
// room costs the account, so this one never clicks Post for you. Once the
// page becomes a real thread it tells the board the post is live and offers
// to drop the first comment underneath it.
(function v2Submit() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function deepAll(sel, root = document, out = []) {
    try { for (const el of root.querySelectorAll(sel)) out.push(el); } catch (_) { return out; }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  const visible = (e) => e && (e.offsetParent !== null || e.getClientRects().length);
  const textOf = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (_) { res(null); } });

  let PEND = null, card = null, msgEl = null, dead = false;

  function ensureCard() {
    if (card || dead) return;
    card = document.createElement("div");
    card.id = "v2-post-card";
    card.style.cssText = "position:fixed;right:16px;bottom:16px;width:380px;max-height:70vh;overflow:auto;z-index:2147483647;background:#12151c;color:#e8eaf0;border:1px solid #262b36;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.55 -apple-system,Segoe UI,sans-serif;padding:14px;display:flex;flex-direction:column;gap:9px";
    card.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
        <b style="color:#4ade80">Growth Board</b>
        <span id="v2-where" style="margin-left:auto;font-size:12px;color:#98a0b3"></span>
        <button id="v2-x" type="button" style="background:none;border:0;color:#98a0b3;cursor:pointer;font-size:15px">✕</button>
      </div>
      <div id="v2-msg" style="color:#98a0b3;font-size:12px">Looking for today's post…</div>
      <div id="v2-title" style="font-weight:600;font-size:13px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="v2-fill" type="button" style="background:#4ade80;border:0;color:#08120c;font-weight:700;padding:7px 12px;border-radius:8px;cursor:pointer">Fill the form</button>
        <button id="v2-copy-t" type="button" style="background:#1e222b;border:1px solid #262b36;color:#e8eaf0;padding:7px 10px;border-radius:8px;cursor:pointer">Copy title</button>
        <button id="v2-copy-b" type="button" style="background:#1e222b;border:1px solid #262b36;color:#e8eaf0;padding:7px 10px;border-radius:8px;cursor:pointer">Copy body</button>
      </div>
      <div style="font-size:11px;color:#6b7280;border-top:1px solid #1e222b;padding-top:8px">You press Reddit's Post button. The board never posts for you — one wrong room and the account is gone.</div>`;
    document.body.appendChild(card);
    msgEl = card.querySelector("#v2-msg");
    card.querySelector("#v2-x").onclick = () => { dead = true; card.remove(); card = null; };
    card.querySelector("#v2-fill").onclick = () => fill(true);
    card.querySelector("#v2-copy-t").onclick = () => copy(PEND && PEND.title, "title");
    card.querySelector("#v2-copy-b").onclick = () => copy(PEND && PEND.body, "body");
  }
  function say(t, color) { ensureCard(); if (msgEl) { msgEl.textContent = t; msgEl.style.color = color || "#98a0b3"; } }
  function where(t) { ensureCard(); const e = card && card.querySelector("#v2-where"); if (e) e.textContent = t; }
  async function copy(text, what) { if (!text) return; try { await navigator.clipboard.writeText(text); say("copied the " + what + " — paste it in"); } catch (_) { say("could not copy — select it by hand", "#f59e0b"); } }

  function findTitle() {
    return deepAll('textarea[name="title"], input[name="title"], textarea[placeholder*="Title" i], input[placeholder*="Title" i], faceplate-textarea-input textarea, #innerTextArea').filter(visible)
      .filter((e) => !e.closest("#v2-post-card"))[0] || null;
  }
  function findBody() {
    return deepAll('shreddit-composer [contenteditable="true"], [data-lexical-editor="true"][contenteditable="true"], textarea[name="body"], textarea[placeholder*="body" i], textarea[placeholder*="Text" i], div[contenteditable="true"][role="textbox"]').filter(visible)
      .filter((e) => !e.closest("#v2-post-card"))[0] || null;
  }
  async function setNative(el, text) {
    el.scrollIntoView({ block: "center" });
    el.focus();
    await sleep(80);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === text;
  }
  // Lexical builds real paragraphs out of a paste, but execCommand("insertText")
  // with newlines in the string silently drops them — which is how a numbered
  // offer arrives as one run-on wall with no space where the break was. So the
  // paste goes first, the result is checked line by line, and only if that
  // fails do we type it a line at a time with a real paragraph break between.
  const linesOf = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  function blockText(el) { return (el.innerText !== undefined ? el.innerText : el.textContent) || ""; }
  function linesLanded(el, text) {
    const want = linesOf(text);
    if (want.length <= 1) return blockText(el).replace(/\s+/g, " ").includes(want[0] ? want[0].slice(0, 24) : "");
    // Two shapes count as landed. A block editor like Lexical puts each
    // paragraph in its own element, so innerText carries the breaks. A plain
    // contenteditable keeps raw newlines in one text node, where innerText
    // collapses them to spaces but textContent still has them. Either is fine;
    // only text with no breaks at all in either is the run-on wall.
    const ok = (raw) => {
      let i = 0;
      for (const g of linesOf(raw)) { if (i < want.length && g.startsWith(want[i].slice(0, Math.min(18, want[i].length)))) i += 1; }
      return i >= want.length;
    };
    return ok(blockText(el)) || ok(el.textContent || "");
  }
  async function pasteInto(el, text) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) { return false; }
    await sleep(320);
    return !!blockText(el).trim();
  }
  // execCommand only writes where the caret is, and clearing the box loses it.
  // Without putting it back, every typed line goes nowhere at all.
  function caretToEnd(el) {
    try {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    } catch (_) { /* best effort */ }
  }
  // execCommand is unreliable here — it returns false and fires nothing
  // whenever the document is not the one the browser thinks is focused, which
  // is most of the time for a tab the board just opened. A synthetic
  // beforeinput needs no focus and is what Lexical listens to anyway, so that
  // goes first and execCommand is only the last resort.
  function beforeInput(el, inputType, data) {
    try { el.dispatchEvent(new InputEvent("beforeinput", { inputType, data: data === undefined ? null : data, bubbles: true, cancelable: true })); return true; }
    catch (_) { return false; }
  }
  async function breakLine(el) {
    beforeInput(el, "insertParagraph");
    await sleep(50);
    if (!/\n\s*$/.test(blockText(el))) {
      caretToEnd(el);
      try { document.execCommand("insertParagraph"); } catch (_) { /* nothing left */ }
      await sleep(50);
    }
  }
  async function typeLines(el, text) {
    const want = linesOf(text);
    for (let i = 0; i < want.length; i += 1) {
      const before = blockText(el).length;
      beforeInput(el, "insertText", want[i]);
      await sleep(50);
      if (blockText(el).length <= before) {
        // nothing moved: try the old way with the caret put back first
        caretToEnd(el);
        try { document.execCommand("insertText", false, want[i]); } catch (_) { /* keep going */ }
        await sleep(50);
      }
      if (i < want.length - 1) await breakLine(el);
    }
    await sleep(220);
  }
  // Returns whether the box actually ended up empty. It matters: writing into
  // a box that still holds the old text is what produced "Sent you a DM.Sent
  // you a DM.", so if this cannot empty it we refuse to write at all.
  async function clearRich(el) {
    if (!blockText(el).trim()) return true;
    el.focus();
    try {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand("delete");
    } catch (_) { /* best effort */ }
    await sleep(90);
    if (!blockText(el).trim()) return true;
    beforeInput(el, "deleteContent");
    await sleep(60);
    if (!blockText(el).trim()) return true;
    beforeInput(el, "deleteContentBackward");
    await sleep(90);
    return !blockText(el).trim();
  }
  async function setRich(el, text) {
    el.scrollIntoView({ block: "center" });
    el.focus();
    await sleep(120);
    if (linesLanded(el, text)) return true;          // already correct: never write it twice
    if (!(await clearRich(el))) return false;        // never write into a box we could not empty
    if (await pasteInto(el, text) && linesLanded(el, text)) return true;
    // paste was blocked or flattened it: type it, keeping the breaks by hand
    if (!(await clearRich(el))) return false;
    await typeLines(el, text);
    return linesLanded(el, text);
  }

  async function fill(loud) {
    if (!PEND) { if (loud) say("nothing scheduled — open a day from the board", "#f59e0b"); return; }
    const t = findTitle(), b = findBody();
    if (!t && !b) { if (loud) say("cannot see Reddit's form yet — scroll to it and press Fill again", "#f59e0b"); return; }
    let okT = true, okB = true;
    if (t) okT = await setNative(t, PEND.title);
    if (b) okB = await setRich(b, PEND.body); else okB = false;
    if (okT && okB) say(`filled, ${linesOf(PEND.body).length} paragraphs — read it, then press Reddit's Post button`, "#4ade80");
    else if (okT) say("title in, but the body did not come out right — press Copy body and paste it in yourself.", "#f59e0b");
    else say("could not fill it — use the copy buttons", "#f59e0b");
  }

  // Once the submit page turns into a real thread, the post is live.
  let marked = false;
  async function watchForLive() {
    const m = location.pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (!m || marked || !PEND) return;
    marked = true;
    await send({ type: "v2-posted", n: PEND.n, url: location.origin + location.pathname });
    say("posted, and the board knows. Comments on it become leads within the hour.", "#4ade80");
    if (PEND.first_comment) {
      const b = card && card.querySelector("#v2-fill");
      if (b) { b.textContent = "Copy the first comment"; b.onclick = () => copy(PEND.first_comment, "first comment"); }
      say("posted. Now drop the first comment underneath it — press the button and paste.", "#4ade80");
    }
  }

  async function boot() {
    const p = await send({ type: "v2-pending" });
    if (!p || p.none) return;                       // nothing scheduled: stay invisible
    PEND = p;
    ensureCard();
    where("r/" + p.sub + " · day " + p.n);
    card.querySelector("#v2-title").textContent = p.title || "";
    if (p.weekly) { say("this room takes offers only in its weekly thread — open that thread, then press Copy body.", "#f59e0b"); return; }
    say("filling Reddit's form…");
    for (let i = 0; i < 8; i += 1) { await sleep(700); if (findTitle() || findBody()) break; }
    await fill(false);
  }

  boot();
  setInterval(watchForLive, 1500);
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; marked = false; boot(); } }, 1500);
})();
