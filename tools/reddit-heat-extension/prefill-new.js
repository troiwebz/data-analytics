// Runs on www.reddit.com (new Reddit) thread pages only. Puts the reply the
// hunt chose into Reddit's comment editor so you read it and click Comment.
// New Reddit's composer is a Lexical editor inside shadow DOM, collapsed until
// clicked, so this expands it, types into it, and watches for the click.
// Nothing is submitted by this script.
(async function prefillNewReddit() {
  if (!/\/comments\/[a-z0-9]+/i.test(location.pathname)) return;
  const { pendingReply } = await chrome.storage.local.get(["pendingReply"]);
  if (!pendingReply || !pendingReply.text) return;
  const idOf = (u) => ((u || "").match(/\/comments\/([a-z0-9]+)/i) || [])[1];
  if (idOf(pendingReply.permalink) !== idOf(location.pathname)) return;
  if (Date.now() - (pendingReply.at || 0) > 20 * 60000) { chrome.storage.local.remove("pendingReply"); return; }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // querySelector that also walks into every open shadow root
  function deep(sel, root = document) {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) { const r = deep(sel, el.shadowRoot); if (r) return r; }
    }
    return null;
  }
  const note = document.createElement("div");
  note.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:720px;padding:10px 16px;border-radius:10px;background:#ff5722;color:#fff;font:14px/1.4 -apple-system,Segoe UI,sans-serif;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  document.body.appendChild(note);
  const say = (t, bg) => { note.textContent = t; if (bg) note.style.background = bg; };
  say("Opening the comment box…");

  // 1. expand the composer if it is collapsed
  let editor = null;
  for (let i = 0; i < 60 && !editor; i += 1) {
    editor = deep('shreddit-composer [contenteditable="true"]') || deep('comment-composer-host [contenteditable="true"]') || deep('[data-lexical-editor="true"][contenteditable="true"]');
    if (editor) break;
    const trigger = deep("comment-composer-host") || deep('[data-testid="trigger-button"]') || deep("shreddit-async-loader[bundlename='comment_composer']");
    if (trigger && i % 4 === 0) { trigger.scrollIntoView({ block: "center" }); trigger.click(); const inner = trigger.querySelector("button, [role=button], div") ; if (inner) inner.click(); }
    await sleep(250);
  }
  if (!editor) {
    say("Could not find Reddit's comment box (logged out, locked, or Reddit changed its page). The reply is on your clipboard — click the box and press ⌘V.", "#c62828");
    return;
  }

  // 2. type into it the way a person would, so Reddit's editor registers it
  editor.scrollIntoView({ block: "center" });
  editor.focus();
  await sleep(150);
  let typed = false;
  try { typed = document.execCommand("insertText", false, pendingReply.text); } catch (_) { /* no execCommand */ }
  if (!typed || !(editor.textContent || "").includes(pendingReply.text.slice(0, 20))) {
    // fall back to a paste-style insertion
    try {
      const dt = new DataTransfer(); dt.setData("text/plain", pendingReply.text);
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(200);
    } catch (_) { /* leave it to the clipboard */ }
  }
  const ok = (editor.textContent || "").includes(pendingReply.text.slice(0, 20));
  const host = editor.closest("shreddit-composer") || editor.getRootNode().host || editor;
  (host.style ? host : editor).style.outline = "3px solid #ff5722";
  say(ok ? "Reply filled in. Read it, edit if you like, then click Comment. It is marked as replied the moment you do."
         : "The box is open but Reddit would not take the text. It is on your clipboard — click in the box and press ⌘V.", ok ? "#ff5722" : "#d29922");
  chrome.storage.local.remove("pendingReply");

  // 3. the click on Reddit's own Comment button marks the post replied
  const isSubmit = (path) => path.some((el) => el && el.tagName === "BUTTON" && (el.getAttribute("slot") === "submit-button" || el.type === "submit" || /^(comment|reply)$/i.test((el.textContent || "").trim())));
  document.addEventListener("click", (e) => {
    if (!isSubmit(e.composedPath())) return;
    chrome.runtime.sendMessage({ type: "hunt-act", id: pendingReply.id, action: "replied", variant: pendingReply.variant });
    say("Posted. Marked as replied on the hunt page — go back and send the DM.", "#2ea043");
    setTimeout(() => note.remove(), 6000);
  }, true);
})();
