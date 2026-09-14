// Runs on old.reddit.com pages. Scrapes what you are looking at (a subreddit
// listing, a search results page, or a thread) into the extension's store,
// and can walk "next" pages / the next thread automatically.
(async function () {
  if (window.top !== window) return;
  const H = globalThis;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const txt = (el) => (el ? el.textContent.trim() : "");
  const num = (s) => { const m = String(s || "").replace(/,/g, "").match(/-?\d+/); return m ? Number(m[0]) : 0; };

  const isThread = /\/comments\/[a-z0-9]+/i.test(location.pathname);
  const cfg = await new Promise((r) => chrome.runtime.sendMessage({ type: "config" }, r));
  const compiled = H.compileKeywords(cfg.entries || []);

  // ---------------------------------------------------------------- listing
  function scrapeListing() {
    const out = [];
    // /r/sub/new, /r/sub, /r/sub/top …
    for (const t of $$("#siteTable .thing.link")) {
      const title = $("a.title", t);
      out.push({
        id: t.dataset.fullname, sub: t.dataset.subreddit || "", title: txt(title), author: t.dataset.author || "",
        flair: txt($(".linkflairlabel", t)), created: Number(t.dataset.timestamp) || Date.parse(($("time", t) || {}).getAttribute?.("datetime") || "") || 0,
        permalink: t.dataset.permalink || (title && title.getAttribute("href")) || "", linkUrl: t.dataset.url && !t.classList.contains("self") ? t.dataset.url : "",
        body: txt($(".expando .md", t)), score: num(t.dataset.score || txt($(".score.unvoted", t))), comments: num(t.dataset.commentsCount || txt($("a.comments", t))),
      });
    }
    // /r/sub/search?q=…
    for (const t of $$(".search-result-link")) {
      const title = $("a.search-title", t);
      const subLink = $("a.search-subreddit-link", t);
      out.push({
        id: t.dataset.fullname, sub: txt(subLink).replace(/^r\//, ""), title: txt(title), author: txt($("a.author", t)),
        flair: txt($(".linkflairlabel, .search-link-flair", t)), created: Date.parse(($("time", t) || {}).getAttribute?.("datetime") || "") || 0,
        permalink: ($("a.search-comments", t) || title || {}).getAttribute?.("href") || "", linkUrl: "",
        body: txt($(".search-expando .md, .search-result-body", t)), score: num(txt($(".search-score", t))), comments: num(txt($("a.search-comments", t))),
      });
    }
    return out.filter((p) => p.id && p.title).map((f) => H.postFromScrape(f, compiled));
  }

  function nextPageLink() {
    const a = $(".nav-buttons .next-button a, .nextprev a[rel~='next'], a[rel~='next']");
    return a ? a.href : "";
  }

  // ---------------------------------------------------------------- thread
  function scrapeThread() {
    const op = $("#siteTable .thing.link");
    if (!op) return null;
    const opAuthor = op.dataset.author || "";
    const flat = [];
    const walk = (root, parentAuthor) => {
      for (const c of $$(":scope > .thing.comment", root)) {
        const body = txt($(":scope > .entry .usertext-body .md", c));
        flat.push({ author: c.dataset.author || "", body, parentAuthor });
        const child = $(":scope > .child > .sitetable", c);
        if (child) walk(child, c.dataset.author || "");
      }
    };
    const area = $(".commentarea > .sitetable");
    if (area) walk(area, opAuthor);
    const signals = { ...H.summariseFlat(flat, opAuthor), t: Date.now() };
    const post = H.postFromScrape({
      id: op.dataset.fullname, sub: op.dataset.subreddit || "", title: txt($("a.title", op)), author: opAuthor, flair: txt($(".linkflairlabel", op)),
      created: Number(op.dataset.timestamp) || 0, permalink: op.dataset.permalink || location.pathname, linkUrl: op.classList.contains("self") ? "" : op.dataset.url || "",
      body: txt($(".expando .md, .usertext-body .md", op)), score: num(op.dataset.score || txt($(".score.unvoted", op))), comments: num(op.dataset.commentsCount || txt($("a.comments", op))),
    }, compiled);
    return { post, signals, scraped: flat.length };
  }

  // ---------------------------------------------------------------- panel
  const panel = document.createElement("div");
  panel.id = "rlt-panel";
  panel.innerHTML = `
    <style>
      #rlt-panel { position: fixed; right: 14px; bottom: 14px; z-index: 2147483647; background: #fff; color: #17191c; border: 1px solid #e4e6ea; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.16); font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; width: 300px; }
      #rlt-panel header { padding: 9px 12px; background: #ff4500; color: #fff; border-radius: 10px 10px 0 0; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
      #rlt-panel header .hb { display: flex; gap: 4px; }
      #rlt-panel header button { background: rgba(255,255,255,.18); border: 0; color: #fff; font-size: 12px; cursor: pointer; border-radius: 4px; padding: 2px 7px; font: inherit; }
      #rlt-panel header button:hover { background: rgba(255,255,255,.3); }
      #rlt-panel .b { padding: 10px 12px 4px; display: grid; gap: 6px; }
      #rlt-panel button.act { padding: 8px 10px; border: 1px solid #e4e6ea; border-radius: 6px; background: #fff; cursor: pointer; text-align: left; font: inherit; }
      #rlt-panel button.act:hover { background: #f1f2f4; }
      #rlt-panel button.go { background: #ff4500; border-color: #ff4500; color: #fff; font-weight: 600; } #rlt-panel button.go:hover { background: #e63e00; }
      #rlt-panel button.stop { background: #fee2e2; border-color: #fca5a5; color: #991b1b; font-weight: 600; }
      #rlt-panel .s { color: #4b5563; padding: 6px 12px 10px; font-size: 12px; }
      #rlt-panel .pg { display: flex; align-items: center; gap: 6px; color: #6b7280; font-size: 12px; }
      #rlt-panel input { width: 52px; font: inherit; padding: 3px 6px; border: 1px solid #e4e6ea; border-radius: 4px; }
      #rlt-panel.min .b, #rlt-panel.min .s { display: none; }
    </style>
    <header><span>Reddit Lead Threads</span><span class="hb"><button id="rlt-dash" title="open the dashboard">Dashboard</button><button id="rlt-min" title="minimise">–</button></span></header>
    <div class="b"></div>
    <div class="s" id="rlt-status"></div>`;
  document.documentElement.appendChild(panel);
  const body = $(".b", panel), status = $("#rlt-status", panel);
  const say = (s) => { status.textContent = s; };
  $("#rlt-min", panel).addEventListener("click", () => panel.classList.toggle("min"));
  $("#rlt-dash", panel).addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-dashboard" }));
  const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "act " + (cls || ""); b.innerHTML = label; b.addEventListener("click", fn); body.appendChild(b); return b; };
  const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
  const pageLabel = () => {
    const q = new URLSearchParams(location.search).get("q");
    const sub = (location.pathname.match(/\/r\/([^/]+)/) || [])[1] || "";
    if (isThread) return `r/${sub}: ${txt($("#siteTable a.title")).slice(0, 70)}`;
    if (q) return `r/${sub} search “${q}”${location.search.includes("after=") ? " (next page)" : ""}`;
    return `r/${sub}${location.pathname.replace(/^\/r\/[^/]+\/?/, "/")}${location.search.includes("after=") ? " (next page)" : ""}`;
  };
  const source = () => ({ url: location.href, label: pageLabel() });

  const { auto = null } = await chrome.storage.local.get(["auto"]);
  const delayMs = ((auto && auto.delay) || 3) * 1000;
  // Reddit's soft rate limit page: wait a minute and retry instead of skipping.
  if (/too many requests|you are doing that too much|rate limit/i.test(document.title + " " + (document.body ? document.body.innerText.slice(0, 400) : ""))) {
    const r = await send({ type: "sweep-429" });
    const w = (r && r.wait) || 60000;
    say(`Reddit asked us to slow down. All tabs pausing; retrying in ${Math.round(w / 1000)}s…`); setTimeout(() => location.reload(), w); return;
  }

  if (!isThread) {
    const posts = scrapeListing();
    const kept = posts.filter(H.keepPost);
    say(`${posts.length} posts on this page, ${kept.length} match your keywords.`);
    const pagesIn = document.createElement("span");
    pagesIn.className = "pg"; pagesIn.innerHTML = `Pages / threads to walk: <input id="rlt-pages" type="number" min="1" max="40" value="10">`;
    body.appendChild(pagesIn);
    btn("Save this page", "", async () => { const r = await send({ type: "ingest", posts, source: source() }); say(`Saved ${r.kept} threads (${r.total} tracked total).`); });
    btn("Save + walk next pages ▶", "go", async () => {
      const n = Number($("#rlt-pages", panel).value) || 10;
      await chrome.storage.local.set({ auto: { mode: "listing", remaining: n, done: 0, kept: 0, started: Date.now() } });
      location.reload();
    });
    btn("Read comments of top threads ▶", "go", async () => {
      const n = Number($("#rlt-pages", panel).value) || 10;
      const r = await send({ type: "queue", limit: n * 3 });
      if (!r.queue.length) return say("Nothing queued: save some pages first.");
      await chrome.storage.local.set({ auto: { mode: "comments", queue: r.queue, done: 0, started: Date.now() } });
      location.href = "https://old.reddit.com" + r.queue[0];
    });
    const sw = await send({ type: "sweep-page", posts, source: source(), nextUrl: nextPageLink() });
    if (sw && !sw.ignore) {
      btn("■ Stop sweep (all tabs)", "stop", async () => { await send({ type: "sweep-stop" }); say("Stopped."); });
      if (sw.done) say(sw.finished ? "Sweep finished. Open the dashboard." : "This tab is done; other tabs are finishing.");
      else { say(`Saved (${sw.kept} kept). ${sw.stage}. Next in ${Math.round(sw.wait / 1000)}s…`); setTimeout(() => { location.href = sw.go; }, sw.wait); }
    } else if (auto && auto.mode === "listing" && auto.remaining > 0) {
      btn("■ Stop walking", "stop", async () => { await chrome.storage.local.remove("auto"); say("Stopped."); });
      const r = await send({ type: "ingest", posts, source: source() });
      const next = nextPageLink();
      const a = { ...auto, remaining: auto.remaining - 1, done: auto.done + 1, kept: auto.kept + r.kept };
      if (a.remaining > 0 && next) {
        await chrome.storage.local.set({ auto: a });
        say(`Page ${a.done} saved (${a.kept} threads so far). Next page in 3s…`);
        setTimeout(() => { location.href = next; }, 3000);
      } else {
        await chrome.storage.local.remove("auto");
        say(`Done: ${a.done} pages, ${a.kept} threads saved. Now click "Read comments of top threads".`);
      }
    }
  } else {
    const r = scrapeThread();
    if (!r) return say("Could not read this thread.");
    const s = r.signals;
    say(`${r.scraped} comments: ${s.lead} hand-raises, ${s.buyer} buyer questions, ${s.opReplies} OP replies${s.closed ? ", OP says booked" : ""}.`);
    btn("Save this thread's comments", "", async () => { await send({ type: "signals", post: r.post, signals: s, source: source() }); say("Saved."); });
    const st = await send({ type: "status-by-url", permalink: location.pathname });
    const stBox = document.createElement("div"); stBox.className = "pg"; stBox.style.marginTop = "4px";
    const cur = st && st.id ? st.status : "new";
    stBox.innerHTML = `<span>Status:</span> <select id="rlt-st" style="width:auto;font:inherit;padding:2px 4px;border:1px solid #e4e6ea;border-radius:4px">${STATUSES.map((x) => `<option value="${x.key}" ${x.key === cur ? "selected" : ""}>${x.label}</option>`).join("")}</select>`;
    body.appendChild(stBox);
    $("#rlt-st", panel).addEventListener("change", async (e) => {
      let id = st && st.id;
      if (!id) { await send({ type: "signals", post: r.post, signals: s, source: source() }); id = r.post.id; }
      await send({ type: "override", id, patch: { status: e.target.value } });
      say(`Marked ${e.target.options[e.target.selectedIndex].text}.`);
    });
    const sw = await send({ type: "sweep-thread", post: r.post, signals: s, source: source() });
    if (sw && !sw.ignore) {
      btn("■ Stop sweep (all tabs)", "stop", async () => { await send({ type: "sweep-stop" }); say("Stopped."); });
      if (sw.done) say(sw.finished ? "Sweep finished. Open the dashboard." : "This tab is done; other tabs are finishing.");
      else { say(`Saved. ${sw.stage}. Next in ${Math.round(sw.wait / 1000)}s…`); setTimeout(() => { location.href = sw.go; }, sw.wait); }
    } else if (auto && auto.mode === "comments" && auto.queue && auto.queue.length) {
      btn("■ Stop reading", "stop", async () => { await chrome.storage.local.remove("auto"); say("Stopped."); });
      await send({ type: "signals", post: r.post, signals: s, source: source() });
      const queue = auto.queue.filter((p) => p !== r.post.permalink && !location.pathname.startsWith(p));
      const a = { ...auto, queue, done: auto.done + 1 };
      if (queue.length) {
        await chrome.storage.local.set({ auto: a });
        say(`Thread ${a.done} saved. ${queue.length} left, next in ${delayMs / 1000}s…`);
        setTimeout(() => { location.href = "https://old.reddit.com" + queue[0]; }, delayMs);
      } else {
        await chrome.storage.local.remove("auto");
        say(`Done: ${a.done} threads read. Open the dashboard to see the ranking.`);
      }
    }
  }
})();


// The co-founder hunt reads Reddit's JSON through this tab: a same-origin fetch
// carrying your own logged-in session, which the extension worker cannot do on
// its own (Reddit answers those with 403). Reading only; nothing is submitted.
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || msg.type !== "hunt-fetch") return;
  fetch(msg.url, { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((json) => reply({ ok: true, json }))
    .catch((e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});

// ---------------------------------------------------------------------------
// Pre-filled reply. The hunt page stores the text it wants posted and opens
// the thread; here we put it in Reddit's own comment box, highlighted, with
// the cursor in it. You read it and click Reddit's "save". The click is yours.
// When the form is submitted, the post is marked replied on the hunt page.
// ---------------------------------------------------------------------------
(async function prefillReply() {
  if (!/\/comments\/[a-z0-9]+/i.test(location.pathname)) return;
  const { pendingReply } = await chrome.storage.local.get(["pendingReply"]);
  if (!pendingReply || !pendingReply.text) return;
  const idOf = (u) => ((u || "").match(/\/comments\/([a-z0-9]+)/i) || [])[1];
  if (idOf(pendingReply.permalink) !== idOf(location.pathname)) return;
  if (Date.now() - (pendingReply.at || 0) > 20 * 60000) { chrome.storage.local.remove("pendingReply"); return; }

  const ta = document.querySelector(".commentarea > .usertext .usertext-edit textarea, .commentarea form.usertext textarea");
  const note = document.createElement("div");
  note.style.cssText = "margin:8px 0;padding:8px 12px;border-radius:8px;background:#ff5722;color:#fff;font:13px/1.4 -apple-system,Segoe UI,sans-serif;font-weight:600";
  if (!ta) {
    note.textContent = "Reddit Lead Threads: no comment box here (logged out, or locked thread). The reply is on your clipboard.";
    (document.querySelector(".commentarea") || document.body).prepend(note);
    return;
  }
  const form = ta.closest("form");
  ta.value = pendingReply.text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.dispatchEvent(new Event("change", { bubbles: true }));
  ta.style.outline = "3px solid #ff5722";
  ta.style.minHeight = "110px";
  note.textContent = "Reply pre-filled from the hunt. Read it, edit if you like, then click save below. It is marked as replied the moment you do.";
  form.parentNode.insertBefore(note, form);
  ta.scrollIntoView({ block: "center" });
  ta.focus();
  const marked = () => {
    chrome.runtime.sendMessage({ type: "hunt-act", id: pendingReply.id, action: "replied", variant: pendingReply.variant });
    note.textContent = "Posted. Marked as replied on the hunt page — go back and send the DM.";
    note.style.background = "#2ea043";
  };
  form.addEventListener("submit", marked, { once: true });
  const btn = form.querySelector("button[type=submit], .usertext-buttons button");
  if (btn) btn.addEventListener("click", marked, { once: true });
  chrome.storage.local.remove("pendingReply");
})();


// ---------------------------------------------------------------------------
// Pre-filled reply inside a private-message thread (old.reddit.com/message/…).
// The hunt's Inbox stores the drafted reply; here we open the reply box under
// the last message from them, fill it, and mark the thread handled on save.
// ---------------------------------------------------------------------------
(async function prefillMessageReply() {
  if (!/^\/message\//.test(location.pathname)) return;
  const { pendingMessage } = await chrome.storage.local.get(["pendingMessage"]);
  if (!pendingMessage || !pendingMessage.text) return;
  if (Date.now() - (pendingMessage.at || 0) > 20 * 60000) { chrome.storage.local.remove("pendingMessage"); return; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const note = document.createElement("div");
  note.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:720px;padding:10px 16px;border-radius:10px;background:#ff5722;color:#fff;font:14px/1.4 -apple-system,Segoe UI,sans-serif;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  document.body.appendChild(note);
  const say = (t, bg) => { note.textContent = t; if (bg) note.style.background = bg; };
  // the message we are answering, else the last one on the page
  let msg = pendingMessage.replyTo ? document.querySelector(`.message[data-fullname="${pendingMessage.replyTo}"], .thing[data-fullname="${pendingMessage.replyTo}"]`) : null;
  const all = Array.from(document.querySelectorAll(".message, .thing.message"));
  if (!msg) msg = all[all.length - 1];
  if (!msg) { say("Could not find the message on this page. The reply is on your clipboard — press ⌘V in the reply box.", "#c62828"); return; }
  // old.reddit keeps the reply form hidden until its "reply" link is clicked
  const visible = (el) => !!(el && el.offsetParent);
  let ta = msg.querySelector(".usertext-edit textarea");
  if (!visible(ta)) {
    const link = Array.from(msg.querySelectorAll("a")).find((a) => /^reply$/i.test((a.textContent || "").trim()));
    if (link) { link.click(); await sleep(300); }
    ta = msg.querySelector(".usertext-edit textarea") || document.querySelector(".usertext-edit textarea");
  }
  if (!ta) { say("No reply box here (locked or logged out). The reply is on your clipboard.", "#c62828"); return; }
  ta.value = pendingMessage.text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.style.outline = "3px solid #ff5722"; ta.style.minHeight = "140px";
  ta.scrollIntoView({ block: "center" }); ta.focus();
  say("Reply filled in from the Inbox. Read it, edit if you like, then click save. The thread is marked handled the moment you do.");
  chrome.storage.local.remove("pendingMessage");
  const form = ta.closest("form");
  const done = () => { chrome.runtime.sendMessage({ type: "inbox-act", id: pendingMessage.threadId, action: "handled" }); say("Sent. Marked handled — back to the Inbox for the next one.", "#2ea043"); setTimeout(() => note.remove(), 6000); };
  if (form) { form.addEventListener("submit", done, { once: true }); const btn = form.querySelector("button[type=submit], .usertext-buttons button"); if (btn) btn.addEventListener("click", done, { once: true }); }
})();
