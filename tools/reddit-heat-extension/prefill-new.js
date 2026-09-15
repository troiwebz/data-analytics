// Runs on www.reddit.com (new Reddit) thread pages. Puts the reply the hunt
// chose into Reddit's comment editor so you read it and click Comment.
// New Reddit's composer is a Lexical editor inside shadow DOM, collapsed until
// clicked, and the site navigates without reloading, so this keeps watching:
// open the composer, type, show what happened, and hand over if it can't.
// Sending: off by default in spirit - the text is filled and a ten second
// countdown runs, visible and cancellable, before Reddit's own button is
// clicked. autoSend = false in storage turns the countdown off entirely and
// nothing is ever submitted by this script.
(function prefillNewReddit() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const idOf = (u) => ((u || "").match(/\/comments\/([a-z0-9]+)/i) || [])[1];

  function deepAll(sel, root = document, out = []) {
    for (const el of root.querySelectorAll(sel)) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  const deep = (sel) => deepAll(sel)[0] || null;
  const visible = (e) => e && (e.offsetParent !== null || e.getClientRects().length);
  const textOf = (el) => (el && (el.innerText || el.textContent) || "").replace(/\s+/g, " ").trim();

  // ---- the little card, same idea as the one in Chat ----------------------
  let card, cardMsg, off = false;
  function ensureCard() {
    if (card || off) return;
    card = document.createElement("div");
    card.id = "rlt-reply";
    card.style.cssText = "position:fixed;right:16px;bottom:16px;width:360px;z-index:2147483647;background:#171a21;color:#e8eaf0;border:1px solid #262b36;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.5 -apple-system,Segoe UI,sans-serif;padding:12px;display:flex;flex-direction:column;gap:8px";
    card.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="color:#ff5722">Public reply</b><span id="rlt-r-state" style="margin-left:auto;font-size:12px;color:#98a0b3"></span><button id="rlt-r-x" style="background:none;border:0;color:#98a0b3;cursor:pointer;font-size:15px">✕</button></div>
      <div id="rlt-r-msg" style="color:#98a0b3;font-size:12px">Opening Reddit's comment box…</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="rlt-r-go" style="background:#ff5722;border:0;color:#fff;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer">Fill the box</button>
        <button id="rlt-r-copy" style="background:#1e222b;border:1px solid #262b36;color:#e8eaf0;padding:7px 10px;border-radius:7px;cursor:pointer">Copy the reply</button>
      </div>`;
    document.body.appendChild(card);
    cardMsg = card.querySelector("#rlt-r-msg");
    card.querySelector("#rlt-r-x").onclick = () => { sendCancel(""); off = true; card.remove(); card = null; };
    card.querySelector("#rlt-r-go").onclick = () => { STEP.tries = 0; STEP.done = false; run(true); };
    card.querySelector("#rlt-r-copy").onclick = async () => { try { await navigator.clipboard.writeText(STEP.text); say("copied — click Reddit's box and press ⌘V"); } catch (_) { /* focus rules */ } };
  }
  function say(t, color) { ensureCard(); if (cardMsg) { cardMsg.textContent = t; cardMsg.style.color = color || "#98a0b3"; } }
  function state(t, color) { ensureCard(); const el = card && card.querySelector("#rlt-r-state"); if (el) { el.textContent = t; el.style.color = color || "#98a0b3"; } }

  // ---- finding and opening Reddit's composer ------------------------------
  function findEditor() {
    const cands = deepAll('shreddit-composer [contenteditable="true"], comment-composer-host [contenteditable="true"], [data-lexical-editor="true"][contenteditable="true"], faceplate-form [contenteditable="true"], textarea[name="comment"], div[contenteditable="true"][role="textbox"]')
      .filter(visible).filter((e) => !e.closest("#rlt-reply"));
    return cands[0] || null;
  }
  function openComposer() {
    const hosts = deepAll("comment-composer-host, shreddit-composer, shreddit-async-loader[bundlename='comment_composer']").filter(visible);
    for (const h of hosts) {
      const inner = h.querySelector('button, [role="button"], [contenteditable], div');
      (inner || h).scrollIntoView({ block: "center" });
      (inner || h).click();
    }
    // the "Add a comment" / "Join the conversation" placeholder
    const holders = deepAll('button, [role="button"], div, p, span').filter(visible)
      .filter((e) => !e.closest("#rlt-reply"))
      .filter((e) => /^(add a comment|join the conversation|what are your thoughts\??|write a comment|comment)$/i.test(textOf(e)));
    if (holders[0]) { holders[0].scrollIntoView({ block: "center" }); holders[0].click(); }
    return hosts.length || holders.length;
  }
  async function typeInto(editor, text) {
    editor.scrollIntoView({ block: "center" });
    editor.focus();
    await sleep(120);
    if (editor.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return editor.value === text;
    }
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (_) { /* try paste */ }
    if (!ok || !textOf(editor).includes(text.slice(0, 20))) {
      try {
        const dt = new DataTransfer(); dt.setData("text/plain", text);
        editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(200);
      } catch (_) { /* clipboard fallback below */ }
    }
    return textOf(editor).includes(text.slice(0, 20));
  }

  // ---- Reddit's own Comment button ----------------------------------------
  function findSubmit() {
    const all = deepAll("button").filter(visible).filter((b) => !b.closest("#rlt-reply"));
    const named = all.filter((b) => b.getAttribute("slot") === "submit-button" || b.type === "submit" || /^(comment|reply|post)$/i.test(textOf(b)));
    // a disabled button means Reddit has not accepted the text yet
    return named.find((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true") || null;
  }

  // Ten seconds, counted down in the card, with a Stop button. Anything the
  // user does - Stop, the X, a click in the page - cancels it.
  const SEND = { timer: 0, left: 0, id: "" };
  function sendCancel(why) {
    if (!SEND.timer) return;
    clearInterval(SEND.timer); SEND.timer = 0; SEND.id = "";
    const b = card && card.querySelector("#rlt-r-stop");
    if (b) b.remove();
    if (why) say(why, "#e6c76b");
  }
  async function sendCountdown(pendingReply, seconds) {
    if (SEND.id === pendingReply.id) return;
    sendCancel("");
    SEND.id = pendingReply.id; SEND.left = seconds;
    ensureCard();
    if (card && !card.querySelector("#rlt-r-stop")) {
      const b = document.createElement("button");
      b.id = "rlt-r-stop";
      b.type = "button";            // a bare <button> is type=submit, and the submit watcher below counts it
      b.style.cssText = "background:#e6c76b;border:0;color:#171a21;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer";
      b.textContent = "Stop";
      b.onclick = () => sendCancel("Stopped. The reply is in the box - press Reddit's Comment button when you want it to go.");
      card.querySelector("div:last-child").prepend(b);
    }
    const tick = () => {
      if (SEND.left <= 0) {
        clearInterval(SEND.timer); SEND.timer = 0;
        const btn = findSubmit();
        if (!btn) { SEND.id = ""; return say("Could not find Reddit's Comment button, so nothing was sent. The reply is in the box - press it yourself.", "#ff8a65"); }
        say("sending…", "#7ee29a");
        btn.click();                       // the click marks it replied through watchSubmit
        return;
      }
      say(`Sending in ${SEND.left}s. Press Stop to read it first.`, "#e6c76b");
      SEND.left -= 1;
    };
    tick();
    SEND.timer = setInterval(tick, 1000);
  }

  // ---- the loop ------------------------------------------------------------
  const STEP = { id: "", text: "", tries: 0, done: false, watching: false, busy: false };
  async function run(force) {
    if (STEP.busy) return;
    if (!/\/comments\/[a-z0-9]+/i.test(location.pathname)) { if (card) { card.remove(); card = null; } STEP.id = ""; STEP.done = false; return; }
    const { pendingReply } = await chrome.storage.local.get(["pendingReply"]);
    if (!pendingReply || !pendingReply.text) return;
    if (idOf(pendingReply.permalink) !== idOf(location.pathname)) return;
    if (Date.now() - (pendingReply.at || 0) > 30 * 60000) { await chrome.storage.local.remove("pendingReply"); return; }
    if (STEP.done && !force) return;
    if (STEP.id !== pendingReply.id) { STEP.id = pendingReply.id; STEP.tries = 0; STEP.done = false; }
    STEP.text = pendingReply.text;
    STEP.busy = true;
    try {
      ensureCard();
      watchSubmit(pendingReply);
      let editor = findEditor();
      if (!editor) {
        STEP.tries += 1;
        if (STEP.tries > 24) { state("stuck", "#ff8a65"); say("Reddit's comment box did not open. The reply is on your clipboard — click the box and press ⌘V, or press Fill the box to try again.", "#ff8a65"); STEP.done = true; return; }
        openComposer();
        say(`opening Reddit's comment box… (${STEP.tries})`, "#e6c76b");
        return;
      }
      const ok = await typeInto(editor, pendingReply.text);
      const host = editor.closest("shreddit-composer") || editor;
      if (host && host.style) host.style.outline = "3px solid #ff5722";
      if (ok) {
        state("filled ✓", "#7ee29a");
        STEP.done = true;
        await chrome.storage.local.set({ pendingReply: { ...pendingReply, filled: true } });
        const { autoSend = true, autoSendSecs = 10 } = await chrome.storage.local.get(["autoSend", "autoSendSecs"]);
        if (autoSend) sendCountdown(pendingReply, Math.max(3, Math.min(60, Number(autoSendSecs) || 10)));
        else say("Reply is in the box. Read it, then click Reddit's Comment button — the post is marked replied the moment you do.", "#7ee29a");
      } else {
        STEP.tries += 1;
        if (STEP.tries > 6) { state("paste it", "#e6c76b"); say("The box is open but Reddit would not take the text. It is on your clipboard — click in the box and press ⌘V.", "#e6c76b"); STEP.done = true; }
      }
    } finally { STEP.busy = false; }
  }

  // Reddit's own Comment button marks the post replied on the hunt page.
  let watched = false;
  function watchSubmit(pendingReply) {
    if (watched) return;
    watched = true;
    // our own card's buttons are not Reddit's
    const isSubmit = (path) => !path.some((el) => el && el.id === "rlt-reply")
      && path.some((el) => el && el.tagName === "BUTTON" && (el.getAttribute("slot") === "submit-button" || el.type === "submit" || /^(comment|reply|post)$/i.test(textOf(el))));
    document.addEventListener("click", async (e) => {
      if (!isSubmit(e.composedPath())) return;
      sendCancel("");
      chrome.runtime.sendMessage({ type: "hunt-act", id: pendingReply.id, action: "replied", variant: pendingReply.variant });
      await chrome.storage.local.remove("pendingReply");
      state("posted ✓", "#7ee29a");
      say("Posted, and marked as replied on the hunt page. Go back and send the DM.", "#7ee29a");
      setTimeout(() => { if (card) { card.remove(); card = null; } }, 6000);
    }, true);
  }

  // new Reddit navigates without reloading, so keep looking
  setInterval(run, 1200);
  setTimeout(run, 400);
})();
