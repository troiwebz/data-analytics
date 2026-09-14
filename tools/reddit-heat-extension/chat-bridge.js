// Runs inside Reddit Chat (reddit.com/chat/… and chat.reddit.com). Reddit moved
// user-to-user DMs into Chat, which has no readable API, so this reads what is
// on screen, hands it to the Inbox, and shows a small panel on the page with the
// drafted reply: Fill puts it in Chat's box, you press Chat's send, Sent marks it
// handled. Nothing is sent by this script.
(function chatBridge() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let me = "";
  chrome.storage.local.get(["config", "hunt"]).then(({ config = {}, hunt = {} }) => { me = ((config.profile || {}).reddit || hunt.me || "").toLowerCase(); });

  function deepAll(sel, root = document, out = []) {
    for (const el of root.querySelectorAll(sel)) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  function text(el) {
    if (!el) return "";
    let s = "";
    const walk = (root) => { for (const n of root.childNodes) { if (n.nodeType === 3) s += n.nodeValue + " "; else if (n.nodeType === 1 && !/^(script|style)$/i.test(n.tagName) && !n.closest?.("#rlt-chat, #rlt-mark")) { if (n.shadowRoot) walk(n.shadowRoot); walk(n); } } };
    if (el.shadowRoot) walk(el.shadowRoot);
    walk(el);
    return s.replace(/\s+/g, " ").trim();
  }
  const visible = (e) => e && (e.offsetParent !== null || e.getClientRects().length);

  // Chat's message box: the editable thing lowest on the page ("Message").
  function findComposer() {
    const cands = deepAll('textarea, [contenteditable="true"], [role="textbox"]').filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark"));
    cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return cands[0] || null;
  }

  // Messages: on Reddit's chat every message starts with "Author h:mm AM" on
  // its own line, then the body. Mine = author is me.
  const HEAD = /^([A-Za-z0-9_-]{3,20})\s+(\d{1,2}:\d{2}\s?(?:AM|PM)|Yesterday|Today|\d{1,2}\/\d{1,2}\/\d{2,4})\b\s*/i;
  function readMessages() {
    // candidates: elements whose text starts with an author line; keep the smallest such (the message itself, not the list)
    const all = deepAll("div, li, article, section, rs-message, rs-timeline-message").filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark"));
    const found = [];
    for (const el of all) {
      const t = text(el);
      if (t.length < 4 || t.length > 6000) continue;
      const m = t.match(HEAD);
      if (!m) continue;
      // the body must not itself contain another author line (that would be a container)
      const rest = t.slice(m[0].length);
      if (HEAD.test(rest) || /\s[A-Za-z0-9_-]{3,20}\s+\d{1,2}:\d{2}\s?(AM|PM)\s/i.test(rest)) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      found.push({ author: m[1], body: rest.trim(), top: r.top, size: t.length });
    }
    // dedupe by body: nested wrappers produce the same text; keep the largest element per body (its full bubble)
    const byKey = new Map();
    for (const f of found) { const k = f.author + "|" + f.body; if (!byKey.has(k) || byKey.get(k).size < f.size) byKey.set(k, f); }
    const list = Array.from(byKey.values()).filter((f) => f.body.length > 0).sort((a, b) => a.top - b.top);
    return list.map((f) => ({ author: f.author, mine: me ? f.author.toLowerCase() === me : false, body: f.body }));
  }
  function roomWith(msgs) {
    const other = msgs.find((m) => !m.mine && (!me || m.author.toLowerCase() !== me));
    if (other) return other.author;
    const um = (location.pathname.match(/\/user\/([A-Za-z0-9_-]+)/) || [])[1];
    return um || "";
  }
  const roomKey = () => (location.pathname.match(/\/room\/([^/]+)/) || [])[1] || location.pathname;

  // ---- the panel on the page ----------------------------------------------
  let panel, ta, state, fillBtn, sentBtn, redoBtn, stageEl, noteEl, autoCb;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div"); panel.id = "rlt-chat";
    panel.style.cssText = "position:fixed;right:16px;bottom:96px;width:420px;max-height:70vh;z-index:2147483647;background:#171a21;color:#e8eaf0;border:1px solid #262b36;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.5 -apple-system,Segoe UI,sans-serif;padding:12px;display:flex;flex-direction:column;gap:8px";
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="color:#ff5722">Reply</b><span id="rlt-stage" style="color:#98a0b3;font-size:12px"></span><span id="rlt-state" style="margin-left:auto;font-size:12px;color:#98a0b3"></span><button id="rlt-hide" style="background:none;border:0;color:#98a0b3;cursor:pointer">✕</button></div>
      <div id="rlt-note" style="color:#98a0b3;font-size:12px"></div>
      <textarea id="rlt-ta" style="width:100%;height:170px;background:#0d0f14;color:#e8eaf0;border:1px solid #262b36;border-radius:8px;padding:8px;font:13px/1.5 inherit;resize:vertical"></textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button id="rlt-fill" style="background:#ff5722;border:0;color:#fff;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer">Fill the box</button>
        <button id="rlt-sent" style="background:#2ea043;border:0;color:#fff;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer">Sent ✓</button>
        <button id="rlt-redo" style="background:#1e222b;border:1px solid #262b36;color:#e8eaf0;padding:7px 10px;border-radius:7px;cursor:pointer">Rewrite</button>
        <label style="margin-left:auto;font-size:12px;color:#98a0b3;display:flex;gap:4px;align-items:center"><input type="checkbox" id="rlt-auto">auto-fill when I open a chat</label>
      </div>`;
    document.body.appendChild(panel);
    ta = panel.querySelector("#rlt-ta"); state = panel.querySelector("#rlt-state"); fillBtn = panel.querySelector("#rlt-fill"); sentBtn = panel.querySelector("#rlt-sent"); redoBtn = panel.querySelector("#rlt-redo"); stageEl = panel.querySelector("#rlt-stage"); noteEl = panel.querySelector("#rlt-note"); autoCb = panel.querySelector("#rlt-auto");
    panel.querySelector("#rlt-hide").onclick = () => { panel.style.display = "none"; };
    fillBtn.onclick = () => fill(ta.value).then((r) => { state.textContent = r.ok ? "in the box — read it, press send" : r.error; state.style.color = r.ok ? "#7ee29a" : "#ff8a65"; });
    sentBtn.onclick = async () => { if (!current) return; await chrome.runtime.sendMessage({ type: "inbox-mine", id: current.id, body: ta.value }); state.textContent = "marked sent"; state.style.color = "#7ee29a"; current = null; };
    redoBtn.onclick = () => draft(true);
    chrome.storage.local.get(["chatAutoFill"]).then((x) => { autoCb.checked = !!x.chatAutoFill; });
    autoCb.onchange = () => chrome.storage.local.set({ chatAutoFill: autoCb.checked });
  }

  let current = null, lastSig = "", drafting = false;
  async function draft(force) {
    if (!current || drafting) return;
    drafting = true; ensurePanel(); state.textContent = "writing…"; state.style.color = "#e6c76b";
    const r = await chrome.runtime.sendMessage({ type: "chat-draft", id: current.id, force: !!force });
    drafting = false;
    if (!r || !r.ok) { state.textContent = (r && r.error) || "no draft"; state.style.color = "#ff8a65"; return; }
    ta.value = r.draft.reply;
    stageEl.textContent = "· " + (r.draft.stageLabel || r.draft.stage);
    noteEl.textContent = r.draft.note || "";
    state.textContent = r.draft.engine === "claude" ? "written by Claude" : r.draft.engine === "template" ? "template" : "written";
    state.style.color = "#7ee29a";
    panel.style.display = "";
    const { chatAutoFill } = await chrome.storage.local.get(["chatAutoFill"]);
    if (chatAutoFill && r.needsReply) { const f = await fill(ta.value); if (f.ok) { state.textContent = "auto-filled — read it, press send"; } }
  }

  async function observe() {
    const msgs = readMessages();
    if (!msgs.length) return;
    const w = roomWith(msgs);
    if (!w) return;
    const sig = roomKey() + "|" + w + "|" + msgs.map((m) => (m.mine ? 1 : 0) + m.body.slice(0, 40)).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    const r = await chrome.runtime.sendMessage({ type: "chat-observe", with: w, messages: msgs, url: location.href });
    if (r && r.id) {
      const changed = !current || current.id !== r.id || r.added;
      current = { id: r.id, with: w };
      ensurePanel();
      if (changed) { ta.value = ""; stageEl.textContent = ""; noteEl.textContent = ""; }
      if (r.needsReply) draft(false); else { state.textContent = "nothing to answer here"; state.style.color = "#98a0b3"; if (r.draft) ta.value = r.draft.reply; }
    }
  }

  function dump() {
    const tags = new Set();
    for (const el of deepAll("*")) if (el.tagName.includes("-")) tags.add(el.tagName.toLowerCase());
    const c = findComposer();
    return { url: location.href, me, customTags: Array.from(tags).sort().slice(0, 80), composer: c ? c.tagName + (c.getAttribute("placeholder") ? "[" + c.getAttribute("placeholder") + "]" : "") + (c.isContentEditable ? " contenteditable" : "") : "none", with: roomWith(readMessages()), messages: readMessages().slice(-4) };
  }

  async function fill(txt) {
    const c = findComposer();
    if (!c) return { ok: false, error: "no message box on screen — open the conversation first" };
    c.scrollIntoView({ block: "center" }); c.focus(); await sleep(100);
    let ok = false;
    if (c.tagName === "TEXTAREA" || c.tagName === "INPUT") {
      const proto = c.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(c, txt); c.dispatchEvent(new Event("input", { bubbles: true })); ok = c.value === txt;
    } else {
      try { ok = document.execCommand("insertText", false, txt); } catch (_) { /* below */ }
      if (!ok || !text(c).includes(txt.slice(0, 20))) {
        try { const dt = new DataTransfer(); dt.setData("text/plain", txt); c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); await sleep(150); ok = text(c).includes(txt.slice(0, 20)); } catch (_) { ok = false; }
      }
    }
    c.style.outline = "3px solid #ff5722";
    try { await navigator.clipboard.writeText(txt); } catch (_) { /* focus rules */ }
    return { ok, error: ok ? "" : "Chat would not take the text — it is on your clipboard, press ⌘V in the box" };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg) return;
    if (msg.type === "chat-fill") { fill(msg.text).then(reply); return true; }
    if (msg.type === "chat-dump") { reply(dump()); return; }
    if (msg.type === "chat-read") { observe().then(() => reply({ with: roomWith(readMessages()), messages: readMessages() })); return true; }
  });

  // Always-visible marker: proves the bridge is running in THIS frame and says
  // what it can read. Click it to copy the dump for tuning.
  const mark = document.createElement("div");
  mark.id = "rlt-mark";
  mark.style.cssText = "position:fixed;right:16px;bottom:64px;z-index:2147483646;background:#12141a;color:#98a0b3;border:1px solid #262b36;border-radius:999px;padding:4px 10px;font:11px/1.4 -apple-system,Segoe UI,sans-serif;cursor:pointer;opacity:.92";
  mark.textContent = "hunt bridge · starting…";
  mark.title = "click to copy what the bridge sees (for tuning)";
  mark.onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(dump(), null, 1)); mark.textContent = "copied what I see — paste it to Claude"; } catch (_) { mark.textContent = "could not copy"; } };
  const attach = () => { if (document.body && !mark.isConnected) document.body.appendChild(mark); };
  attach(); setInterval(attach, 2000);
  function markStatus() {
    const msgs = readMessages();
    const c = findComposer();
    const inFrame = window !== window.top;
    mark.textContent = msgs.length
      ? `hunt bridge · read ${msgs.length} messages · with ${roomWith(msgs) || "?"}${c ? "" : " · no box"}${inFrame ? "" : ""}`
      : `hunt bridge · no messages read yet${c ? "" : " · no box"} · click to copy what I see`;
    mark.style.color = msgs.length ? "#7ee29a" : "#e6c76b";
  }
  setInterval(markStatus, 3000);
  setTimeout(markStatus, 1500);

  setInterval(observe, 3000);
  setTimeout(observe, 1200);
})();
