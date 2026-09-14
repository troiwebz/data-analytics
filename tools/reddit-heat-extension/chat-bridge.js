// Runs inside chat.reddit.com. Reddit moved user-to-user DMs into Chat, which
// has no readable API, so this reads what is on screen and hands it to the
// Inbox, and fills the composer with a drafted reply on request. It never
// clicks send.
(function chatBridge() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // querySelectorAll that also walks into every open shadow root
  function deepAll(sel, root = document, out = []) {
    for (const el of root.querySelectorAll(sel)) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  // text of an element INCLUDING everything inside its (nested) shadow roots
  function text(el) {
    if (!el) return "";
    let s = "";
    const walk = (root) => { for (const n of root.childNodes) { if (n.nodeType === 3) s += n.nodeValue + " "; else if (n.nodeType === 1 && !/^(script|style)$/i.test(n.tagName)) { if (n.shadowRoot) walk(n.shadowRoot); walk(n); } } };
    if (el.shadowRoot) walk(el.shadowRoot);
    walk(el);
    return s.replace(/\s+/g, " ").trim();
  }
  // querySelector inside an element, its shadow root, and nested ones
  function deepIn(el, sel) { if (!el) return null; const direct = el.querySelector(sel); if (direct) return direct; if (el.shadowRoot) { const r = deepAll(sel, el.shadowRoot); if (r.length) return r[0]; } return null; }

  // The composer: Chat's message box. Reddit's chat uses rs-* web components;
  // fall back to any editable box near the bottom of the page.
  function findComposer() {
    const cands = deepAll('rs-composer textarea, rs-composer [contenteditable="true"], textarea[name="message"], [data-testid*="composer"] textarea, [data-testid*="composer"] [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea');
    const vis = cands.filter((e) => e.offsetParent !== null || e.getClientRects().length);
    vis.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);   // lowest on the page
    return vis[0] || null;
  }

  // Who the open conversation is with: the header of the room.
  function roomWith() {
    const h = deepAll("rs-room-header, rs-chat-header, [data-testid*='room-header'], header").find((e) => text(e));
    let t = text(h);
    const m = t.match(/u\/([A-Za-z0-9_-]{3,20})/) || t.match(/^([A-Za-z0-9_-]{3,20})\b/);
    if (m) return m[1];
    const um = (location.pathname.match(/\/user\/([A-Za-z0-9_-]+)/) || [])[1];
    return um || "";
  }

  // Messages on screen, oldest first. "mine" = sits on the right half.
  function readMessages() {
    let nodes = deepAll("rs-message, rs-timeline-message, [data-testid*='message-']:not([data-testid*='composer']), [role='listitem']");
    nodes = nodes.filter((n) => text(n).length > 0 && text(n).length < 4000);
    if (!nodes.length) return [];
    const mid = window.innerWidth / 2;
    const out = [];
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (!r.height) continue;
      const own = n.hasAttribute("own") || n.hasAttribute("is-own") || n.hasAttribute("self") || /\b(own|outgoing|self|mine|sent)\b/i.test(n.className || "") || (r.left + r.width / 2) > mid + 40;
      const sender = text(deepIn(n, "rs-user-name, [data-testid*='sender'], .sender, .author")) || "";
      const body = text(deepIn(n, "rs-message-text, .message-text, [data-testid*='text'], p")) || text(n);
      out.push({ mine: own, author: sender, body, top: r.top });
    }
    out.sort((a, b) => a.top - b.top);
    // collapse duplicates the virtual list may render twice
    const seen = new Set();
    return out.filter((m) => { const k = (m.mine ? "M" : "T") + m.body; if (seen.has(k)) return false; seen.add(k); return true; }).map(({ top, ...m }) => m);
  }

  let lastSig = "";
  async function observe() {
    const w = roomWith();
    const msgs = readMessages();
    if (!w || !msgs.length) return;
    const sig = w + "|" + msgs.map((m) => (m.mine ? 1 : 0) + m.body.slice(0, 40)).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    chrome.runtime.sendMessage({ type: "chat-observe", with: w, messages: msgs, url: location.href });
  }

  // What the page looks like, for tuning when Reddit's markup differs.
  function dump() {
    const tags = new Set();
    for (const el of deepAll("*")) if (el.tagName.includes("-")) tags.add(el.tagName.toLowerCase());
    const c = findComposer();
    return { url: location.href, customTags: Array.from(tags).sort().slice(0, 80), composer: c ? c.tagName + (c.getAttribute("data-testid") ? "[" + c.getAttribute("data-testid") + "]" : "") + (c.isContentEditable ? " contenteditable" : "") : "none", with: roomWith(), messages: readMessages().slice(-4) };
  }

  async function fill(txt) {
    const c = findComposer();
    if (!c) return { ok: false, error: "no message box on screen — open the conversation first" };
    c.scrollIntoView({ block: "center" }); c.focus(); await sleep(100);
    let ok = false;
    if (c.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(c, txt); c.dispatchEvent(new Event("input", { bubbles: true })); ok = c.value === txt;
    } else {
      try { ok = document.execCommand("insertText", false, txt); } catch (_) { /* below */ }
      if (!ok || !text(c).includes(txt.slice(0, 20))) {
        try { const dt = new DataTransfer(); dt.setData("text/plain", txt); c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); await sleep(150); ok = text(c).includes(txt.slice(0, 20)); } catch (_) { ok = false; }
      }
    }
    c.style.outline = "3px solid #ff5722";
    return { ok, error: ok ? "" : "Chat would not take the text — it is on your clipboard, press ⌘V in the box" };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg) return;
    if (msg.type === "chat-fill") { fill(msg.text).then(reply); return true; }
    if (msg.type === "chat-dump") { reply(dump()); return; }
    if (msg.type === "chat-read") { observe().then(() => reply({ with: roomWith(), messages: readMessages() })); return true; }
  });

  setInterval(observe, 4000);
  setTimeout(observe, 1500);
})();
