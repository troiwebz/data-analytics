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
    if (auto && auto.mode === "listing" && auto.remaining > 0) {
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
    if (auto && auto.mode === "comments" && auto.queue && auto.queue.length) {
      btn("■ Stop reading", "stop", async () => { await chrome.storage.local.remove("auto"); say("Stopped."); });
      await send({ type: "signals", post: r.post, signals: s, source: source() });
      const queue = auto.queue.filter((p) => p !== r.post.permalink && !location.pathname.startsWith(p));
      const a = { ...auto, queue, done: auto.done + 1 };
      if (queue.length) {
        await chrome.storage.local.set({ auto: a });
        say(`Thread ${a.done} saved. ${queue.length} left, next in 3s…`);
        setTimeout(() => { location.href = "https://old.reddit.com" + queue[0]; }, 3000);
      } else {
        await chrome.storage.local.remove("auto");
        say(`Done: ${a.done} threads read. Open the extension popup to see the ranking.`);
      }
    }
  }
})();
