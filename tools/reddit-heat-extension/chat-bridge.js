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
  // The room list on the left is full of "Name 1:22 PM Name: snippet…" rows
  // that look exactly like messages. Find it (it holds the /chat/room/ links)
  // and read only to the right of it.
  function roomListRight() {
    const links = deepAll('a[href*="/chat/room/"], a[href*="/chat/user/"]').filter(visible);
    if (links.length < 2) return 0;
    let right = 0;
    for (const a of links) right = Math.max(right, a.getBoundingClientRect().right);
    return Math.min(right, window.innerWidth * 0.6);
  }
  const inRoomList = (el) => !!el.closest('a[href*="/chat/room/"], a[href*="/chat/user/"], nav, aside, [role="navigation"]');
  const READER_VERSION = 2;
  function readMessages() {
    const leftEdge = roomListRight();
    // candidates: elements whose text starts with an author line; keep the smallest such (the message itself, not the list)
    const all = deepAll("div, li, article, section, rs-message, rs-timeline-message").filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark") && !inRoomList(e) && e.getBoundingClientRect().left >= leftEdge);
    const found = [];
    for (const el of all) {
      const t = text(el);
      if (t.length < 4 || t.length > 6000) continue;
      const m = t.match(HEAD);
      if (!m) continue;
      // the body must not itself contain another author line (that would be a container)
      const rest = t.slice(m[0].length);
      if (HEAD.test(rest) || /\s[A-Za-z0-9_-]{3,20}\s+\d{1,2}:\d{2}\s?(AM|PM)\s/i.test(rest)) continue;
      if (/^(You|[A-Za-z0-9_-]{3,20}):\s/.test(rest) && /…$/.test(rest)) continue;   // a list-row snippet, not a message
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
  function headerUser() {
    const leftEdge = roomListRight();
    const heads = deepAll("header, h1, h2, h3, [role='heading']").filter(visible).filter((e) => e.getBoundingClientRect().left >= leftEdge && e.getBoundingClientRect().top < 140);
    for (const h of heads) { const t = text(h); const m = t.match(/^(?:u\/)?([A-Za-z0-9_-]{3,20})$/); if (m) return m[1]; }
    return "";
  }
  function roomWith(msgs) {
    const hu = headerUser();
    if (hu && (!me || hu.toLowerCase() !== me)) return hu;
    const others = msgs.filter((m) => !m.mine && (!me || m.author.toLowerCase() !== me)).map((m) => m.author);
    if (others.length) { // the most frequent other author in this column
      const n = {}; for (const a of others) n[a] = (n[a] || 0) + 1;
      return Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    }
    const um = (location.pathname.match(/\/user\/([A-Za-z0-9_-]+)/) || [])[1];
    return um || "";
  }
  const roomKey = () => (location.pathname.match(/\/room\/([^/]+)/) || [])[1] || location.pathname;

  // ---- the panel on the page ----------------------------------------------
  let panel, ta, state, fillBtn, sentBtn, redoBtn, stageEl, noteEl, autoCb, whoEl;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div"); panel.id = "rlt-chat";
    panel.style.cssText = "position:fixed;right:16px;bottom:96px;width:420px;max-height:70vh;z-index:2147483647;background:#171a21;color:#e8eaf0;border:1px solid #262b36;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.5 -apple-system,Segoe UI,sans-serif;padding:12px;display:flex;flex-direction:column;gap:8px";
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="color:#ff5722">Reply</b><span id="rlt-who" style="color:#e8eaf0;font-weight:600"></span><span id="rlt-stage" style="color:#98a0b3;font-size:12px"></span><span id="rlt-state" style="margin-left:auto;font-size:12px;color:#98a0b3"></span><button id="rlt-hide" style="background:none;border:0;color:#98a0b3;cursor:pointer">✕</button></div>
      <div id="rlt-note" style="color:#98a0b3;font-size:12px"></div>
      <textarea id="rlt-ta" style="width:100%;height:170px;background:#0d0f14;color:#e8eaf0;border:1px solid #262b36;border-radius:8px;padding:8px;font:13px/1.5 inherit;resize:vertical"></textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button id="rlt-fill" style="background:#ff5722;border:0;color:#fff;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer">Fill the box</button>
        <button id="rlt-sent" style="background:#2ea043;border:0;color:#fff;font-weight:600;padding:7px 12px;border-radius:7px;cursor:pointer">Sent ✓</button>
        <button id="rlt-redo" style="background:#1e222b;border:1px solid #262b36;color:#e8eaf0;padding:7px 10px;border-radius:7px;cursor:pointer">Rewrite</button>
        <label style="margin-left:auto;font-size:12px;color:#98a0b3;display:flex;gap:4px;align-items:center"><input type="checkbox" id="rlt-auto">auto-fill when I open a chat</label>
      </div>`;
    document.body.appendChild(panel);
    ta = panel.querySelector("#rlt-ta"); state = panel.querySelector("#rlt-state"); whoEl = panel.querySelector("#rlt-who"); fillBtn = panel.querySelector("#rlt-fill"); sentBtn = panel.querySelector("#rlt-sent"); redoBtn = panel.querySelector("#rlt-redo"); stageEl = panel.querySelector("#rlt-stage"); noteEl = panel.querySelector("#rlt-note"); autoCb = panel.querySelector("#rlt-auto");
    panel.querySelector("#rlt-hide").onclick = () => { panel.style.display = "none"; };
    fillBtn.onclick = () => {
      const onScreen = roomWith(readMessages());
      if (current && onScreen && onScreen.toLowerCase() !== current.with.toLowerCase()) { state.textContent = `this reply is for ${current.with}, but the open chat is with ${onScreen} — not filling`; state.style.color = "#ff8a65"; return; }
      fill(ta.value).then(async (r) => {
        state.textContent = r.ok ? "in the box — read it, press send" : r.error; state.style.color = r.ok ? "#7ee29a" : "#ff8a65";
        if (r.ok) await assumeSent();
      });
    };
    sentBtn.onclick = async () => { if (!current) return; await chrome.runtime.sendMessage({ type: "inbox-mine", id: current.id, body: ta.value }); state.textContent = "marked sent"; state.style.color = "#7ee29a"; current = null; };
    redoBtn.onclick = () => draft(true);
    chrome.storage.local.get(["chatAutoFill"]).then((x) => { autoCb.checked = !!x.chatAutoFill; });
    autoCb.onchange = () => chrome.storage.local.set({ chatAutoFill: autoCb.checked });
  }

  let current = null, lastSig = "", drafting = false;
  // Option (on by default): once the reply is in the box, count it as sent so
  // the Inbox strikes the card through. Untick "mark as sent when filled" on
  // the Inbox page to go back to pressing Sent by hand.
  async function assumeSent() {
    const { assumeSent: on = true } = await chrome.storage.local.get(["assumeSent"]);
    if (on === false || !current) return;
    await chrome.runtime.sendMessage({ type: "inbox-mine", id: current.id, body: ta.value });
    state.textContent = "in the box — marked sent; press send"; state.style.color = "#7ee29a";
  }
  async function draft(force) {
    if (!current || drafting) return;
    drafting = true; ensurePanel(); state.textContent = "writing…"; state.style.color = "#e6c76b";
    const r = await chrome.runtime.sendMessage({ type: "chat-draft", id: current.id, force: !!force });
    drafting = false;
    if (!r || !r.ok) { state.textContent = (r && r.error) || "no draft"; state.style.color = "#ff8a65"; return; }
    ta.value = r.draft.reply;
    whoEl.textContent = "to " + current.with;
    stageEl.textContent = "· " + (r.draft.stageLabel || r.draft.stage) + (r.draft.verdict === "not_interested" ? " · CUT" : r.draft.verdict === "interested" ? " · INTERESTED" : "");
    stageEl.style.color = r.draft.verdict === "not_interested" ? "#ff8a65" : r.draft.verdict === "interested" ? "#7ee29a" : "#98a0b3";
    noteEl.textContent = r.draft.note || "";
    state.textContent = r.draft.engine === "claude" ? "written by Claude" : r.draft.engine === "template" ? "template" : "written";
    state.style.color = "#7ee29a";
    panel.style.display = "";
    const { chatAutoFill } = await chrome.storage.local.get(["chatAutoFill"]);
    // auto-fill only when the room on screen is this person's and the box is empty
    const onScreen = roomWith(readMessages());
    const c = findComposer();
    const boxEmpty = c && (c.tagName === "TEXTAREA" ? !c.value.trim() : !text(c).trim());
    if (chatAutoFill && r.needsReply && onScreen && onScreen.toLowerCase() === current.with.toLowerCase() && boxEmpty) {
      const f = await fill(ta.value); if (f.ok) { state.textContent = "auto-filled — read it, press send"; await assumeSent(); }
    } else if (chatAutoFill && !boxEmpty) { state.textContent = "box not empty — not auto-filling"; state.style.color = "#e6c76b"; }
  }

  async function observe() {
    const msgs = readMessages();
    if (!msgs.length) return;
    const w = roomWith(msgs);
    if (!w) return;
    const sig = roomKey() + "|" + w + "|" + msgs.map((m) => (m.mine ? 1 : 0) + m.body.slice(0, 40)).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    const r = await chrome.runtime.sendMessage({ type: "chat-observe", with: w, messages: msgs, url: location.href, v: READER_VERSION });
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
    // clipboard as a fallback for ⌘V; it can hang when the tab has no focus, so never wait on it
    try { await Promise.race([navigator.clipboard.writeText(txt).catch(() => {}), sleep(400)]); } catch (_) { /* focus rules */ }
    return { ok, error: ok ? "" : "Chat would not take the text — it is on your clipboard, press ⌘V in the box" };
  }

  // ---- a DM waiting to be placed (from the hunt card or the Inbox) --------
  // Reddit blocks the old /message/compose and direct /chat/user/ links, so the
  // DM goes through Reddit's own "new chat" page: type the name in its search
  // box, open the chat that comes up, put the text in the box. Send stays yours.
  let pendingBusy = false, pendingTyped = "", pendingClicked = 0, pendingSince = 0;
  const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  function findSearchBox() {
    const inputs = deepAll('input[type="text"], input[type="search"], input:not([type]), [role="combobox"], [contenteditable="true"]').filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark"));
    const named = inputs.filter((e) => /search|user|name|who|people|recipient/i.test((e.getAttribute("placeholder") || "") + " " + (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("name") || "")));
    return named[0] || inputs[0] || null;
  }
  function setValue(el, v) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: v.slice(-1) }));
    } else { el.focus(); try { document.execCommand("selectAll"); document.execCommand("insertText", false, v); } catch (_) { /* below */ } }
  }
  function findResult(name) {
    const els = deepAll('li, a, button, [role="option"], [role="button"], [role="listitem"], div, span').filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark") && !e.closest("header, nav, aside"));
    const hits = els.filter((e) => { const t = text(e); return t && t.length < 80 && (same(t, name) || same(t.replace(/^u\//i, ""), name) || new RegExp("(^|\\s)u?\\/?" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)", "i").test(t)); });
    hits.sort((a, b) => text(a).length - text(b).length);   // the tightest element that says the name
    const h = hits[0]; if (!h) return null;
    // click the real control: a button/link inside the row, else the row's own clickable ancestor
    const inner = h.querySelector ? h.querySelector('button, a, [role="button"], [role="option"]') : null;
    return inner || h.closest('button, a, [role="option"], [role="button"], li, [role="listitem"]') || h;
  }
  let pendingNote = "", pendingNoteAt = 0;
  const say = (t, color) => { pendingNote = t; pendingNoteAt = Date.now(); mark.textContent = t; mark.style.color = color || "#e6c76b"; };
  function findGoButton() {
    const bs = deepAll("button, [role='button'], a").filter(visible).filter((e) => !e.closest("#rlt-chat, #rlt-mark"));
    return bs.find((b) => /^(start( a)? chat|next|create( chat)?|chat|continue|done)$/i.test(text(b))) || null;
  }
  async function placePending() {
    if (pendingBusy) return;
    const { pendingDm } = await chrome.storage.local.get(["pendingDm"]);
    if (!pendingDm || pendingDm.done || !pendingDm.author || !pendingDm.text) return;
    if (Date.now() - (pendingDm.at || 0) > 15 * 60000) { await chrome.storage.local.remove("pendingDm"); return; }
    pendingBusy = true;
    try {
      const name = pendingDm.author;
      if (!pendingSince) pendingSince = Date.now();
      const onCreate = /\/chat\/room\/create/i.test(location.pathname) || !!findSearchBox() && !findComposer();
      const inRoom = !onCreate && (same(roomWith(readMessages()), name) || new RegExp("/user/" + name + "(/|$)", "i").test(location.pathname) || same(headerUser(), name));
      if (inRoom && findComposer()) {
        const r = await fill(pendingDm.text);
        ensurePanel(); whoEl.textContent = "to " + name; ta.value = pendingDm.text; stageEl.textContent = "· first DM"; noteEl.textContent = "";
        state.textContent = r.ok ? "in the box — read it, press send" : r.error; state.style.color = r.ok ? "#7ee29a" : "#ff8a65"; panel.style.display = "";
        say(r.ok ? `hunt bridge · DM for ${name} is in the box — press send` : `hunt bridge · ${r.error}`, r.ok ? "#7ee29a" : "#ff8a65");
        await chrome.storage.local.set({ pendingDm: { ...pendingDm, done: true, filled: r.ok, at: Date.now() } });
        if (pendingDm.kind === "hunt") setTimeout(() => chrome.storage.local.remove("pendingDm"), 4000);
        pendingTyped = ""; pendingClicked = 0; pendingSince = 0;
        return;
      }
      if (onCreate) {
        const box = findSearchBox();
        if (box && pendingTyped !== name) { box.scrollIntoView({ block: "center" }); box.focus(); setValue(box, name); pendingTyped = name; say(`hunt bridge · new chat: typed ${name}, waiting for Reddit's result…`); return; }
        if (pendingTyped === name) {
          const hit = findResult(name);
          if (hit && Date.now() - pendingClicked > 2500) {
            pendingClicked = Date.now(); say(`hunt bridge · opening the chat with ${name}…`);
            hit.click();
            await sleep(600);
            const go = findGoButton(); if (go) go.click();
            return;
          }
          // clicked once and still here: Enter in the search box opens the first result on most search UIs
          if (pendingClicked && Date.now() - pendingClicked > 2000 && box) { for (const type of ["keydown", "keypress", "keyup"]) box.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })); }
        }
        if (Date.now() - pendingSince > 20000) say(`hunt bridge · could not open ${name}'s chat by itself — type the name in Reddit's search box and open the chat; the DM fills itself`, "#ff8a65");
        return;
      }
      // somewhere else in Chat with a DM waiting: say so
      if (Date.now() - pendingSince > 8000) say(`hunt bridge · DM for ${name} waiting — open the chat with them and it fills itself`);
    } catch (e) { say(`hunt bridge · error placing the DM: ${e && e.message || e}`, "#ff8a65"); }
    finally { pendingBusy = false; }
  }
  setInterval(placePending, 1500);
  setTimeout(placePending, 800);

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
    if (pendingNote && Date.now() - pendingNoteAt < 10000) { mark.textContent = pendingNote; return; }
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
