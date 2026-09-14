// Co-founder hunt: one post at a time, a two-line public reply to pick, a DM in
// the length you want, then next. Nobody is ever shown twice.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

let queue = [];        // local working copy, so a skip advances instantly
let cur = null;        // the post on screen
let variant = 0;       // which of the public options is picked
let dmSize = "medium";
let options = [];
let profile = {};
let lastActed = null;

function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.round(m / 60) + "h ago";
  return Math.round(m / 1440) + "d ago";
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function render() {
  const has = !!cur;
  $("wrap").hidden = !has;
  $("empty").hidden = has || !$("hint").hidden;
  if (!has) return;
  const p = cur;
  $("title").textContent = p.title;
  $("title").href = p.permalink;
  const tags = [
    `<span class="tag ${p.role === "technical" ? "tech" : ""}">${p.role}</span>`,
    p.hasBudget ? '<span class="tag money">has money</span>' : "",
    p.equityOnly ? '<span class="tag equity">equity only</span>' : "",
  ].filter(Boolean).join(" ");
  $("meta").innerHTML = `r/${p.sub} · ${esc(p.author)} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments · fit ${p.score} ${tags}`;
  $("body").textContent = p.body || "(no body text)";

  // the reading of the post, under the post
  const s = huntSynopsis(p);
  const rows = [
    ["Who", s.who], ["Wants", s.wants], ["Country", s.country || "not stated"],
    ["Stage", s.stage || "not stated"], ["Money", s.money || "not stated"],
    ["Equity", s.equity], ["Traction", s.traction || s.revenue], ["Time", s.commit],
  ].filter(([, v]) => v);
  $("syn").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  options = huntShortOptions(p, profile, 5);
  if (variant >= options.length) variant = 0;
  $("opts").innerHTML = options.map((o, i) => `<button class="opt ${i === variant ? "on" : ""}" data-i="${i}"><b>OPTION ${i + 1}</b>${esc(o).replace(/\n/g, "<br>")}</button>`).join("");
  for (const b of $("opts").querySelectorAll(".opt")) {
    b.onclick = () => { variant = Number(b.dataset.i); $("short").value = options[variant]; for (const x of $("opts").querySelectorAll(".opt")) x.classList.toggle("on", x === b); };
  }
  $("short").value = options[variant] || "";
  for (const b of $("sizes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.s === dmSize);
  $("dm").value = huntDM(p, profile, dmSize);
  $("repliedMark").hidden = !p.repliedAt;
  $("dmMark").hidden = !p.dmAt;
}

function next() {
  queue.shift();
  cur = queue[0] || null;
  variant = 0;
  render();
}

async function refresh(keepCurrent = true) {
  const r = await send({ type: "hunt-queue", limit: 60 });
  if (!r) return;
  $("sQueue").textContent = r.total;
  $("sToday").textContent = r.contactedToday;
  $("sEver").textContent = r.contactedTotal;
  $("sBlocked").textContent = r.blocked;
  $("sBlockedWrap").title = "posts hidden because you already contacted that person or already replied in the thread";
  $("sPoll").textContent = r.lastError ? "last check failed: " + r.lastError
    : r.lastPoll ? `checked ${ago(r.lastPoll)}${r.server ? " from your server" : ""} · ${r.found} found so far` : "never checked";
  $("sPoll").style.color = r.lastError ? "#ff8a65" : "";
  $("hint").hidden = !r.lastError;
  for (const b of $("win").querySelectorAll("button")) b.classList.toggle("on", Number(b.dataset.h) === r.maxAgeH);
  $("toggle").textContent = r.on ? "Watching · stop" : "Start watching";
  $("toggle").className = r.on ? "" : "primary";

  const keepId = keepCurrent && cur ? cur.id : null;
  const fresh = r.queue;
  queue = keepId && fresh.some((x) => x.id === keepId)
    ? [fresh.find((x) => x.id === keepId), ...fresh.filter((x) => x.id !== keepId)]
    : fresh;
  const prevId = cur && cur.id;
  cur = queue[0] || null;
  if (!cur || cur.id !== prevId) variant = 0;
  render();
}

async function act(action) {
  if (!cur) return;
  lastActed = cur.id;
  await send({ type: "hunt-act", id: cur.id, action, variant });
  if (action === "replied") { cur.repliedAt = Date.now(); render(); refresh(); return; }
  next();
  refresh();
  checkAhead();
}

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  if (!btn) return;
  const was = btn.textContent;
  btn.textContent = "Copied ✓";
  setTimeout(() => { btn.textContent = was; }, 1200);
}

// One click: the text is on the clipboard and the page is open. Paste and go.
$("goPost").onclick = async () => { if (!cur) return; await copyText($("short").value); window.open(cur.permalink, "_blank"); };
$("goDm").onclick = async () => { if (!cur) return; await copyText($("dm").value); window.open(huntComposeUrl(cur, $("dm").value), "_blank"); };
$("copyShort").onclick = () => copyText($("short").value, $("copyShort"));
$("copyDm").onclick = () => copyText($("dm").value, $("copyDm"));
for (const b of document.querySelectorAll("#sizes button")) b.onclick = () => { dmSize = b.dataset.s; render(); };
$("didReply").onclick = () => act("replied");
$("didDm").onclick = () => act("dm");
$("skip").onclick = () => act("skip");
$("bad").onclick = () => act("not_relevant");
$("undo").onclick = async () => { if (lastActed) { await send({ type: "hunt-act", id: lastActed, action: "undo" }); lastActed = null; await refresh(false); } };
$("now").onclick = async () => {
  $("now").textContent = "Checking…"; $("now").disabled = true;
  try {
    const r = await Promise.race([send({ type: "hunt-poll" }), new Promise((ok) => setTimeout(() => ok({ error: "no answer in 45s — reload the pinned old.reddit.com tab" }), 45000))]);
    if (r && r.error) $("sPoll").textContent = "last check failed: " + r.error;
  } finally { $("now").textContent = "Check now"; $("now").disabled = false; refresh(); checkAhead(); }
};
$("toggle").onclick = async () => { await send({ type: "hunt-on", on: $("toggle").textContent.startsWith("Start") }); refresh(); };
for (const b of document.querySelectorAll("#win button")) b.onclick = async () => { await send({ type: "hunt-window", hours: Number(b.dataset.h) }); refresh(false); };

// ---- your details, right here instead of buried in Options ---------------
$("testSrv").onclick = async () => {
  $("srvMsg").textContent = "checking…";
  const r = await send({ type: "hunt-server-test", url: $("cSrv").value.trim() });
  $("srvMsg").textContent = r && r.ok
    ? `server alive · ${r.health.posts} posts held · last poll ${r.health.lastPoll ? new Date(r.health.lastPoll).toLocaleTimeString() : "never"}${r.health.oauth ? "" : " · no reddit api key"}${r.health.lastError ? " · " + r.health.lastError : ""}`
    : "no answer: " + ((r && r.error) || "check the address");
};
$("openSetup").onclick = () => { $("setup").hidden = !$("setup").hidden; };
$("saveSetup").onclick = async () => {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  profile = { ...(config.profile || {}), name: $("cName").value.trim(), role: $("cRole").value.trim(), reddit: $("cReddit").value.trim().replace(/^\/?u\//, ""), whatsapp: $("cWa").value.trim(), telegram: $("cTg").value.trim() };
  await chrome.storage.local.set({ config: { ...config, profile } });
  await send({ type: "hunt-me", me: profile.reddit });
  await send({ type: "hunt-server", url: $("cSrv").value.trim(), token: $("cSrvTok").value.trim() });
  $("setupMsg").hidden = false;
  setTimeout(() => { $("setupMsg").hidden = true; }, 1500);
  render();
};

// ---- tables: click any counter to see exactly what is behind it ----------
function showTable(kind) {
  $("table").hidden = false;
  $("main").hidden = true;
  $("setup").hidden = true;
  $("tableFind").value = "";
  if (kind === "queue") {
    $("tableTitle").textContent = `Queue (${queue.length})`;
    $("tableNote").textContent = "Everyone waiting, best fit first. Click a row to work on that one.";
    $("tableHead").innerHTML = "<tr><th>Post</th><th>Who</th><th>Wants</th><th>Country</th><th>Age</th><th>Fit</th></tr>";
    $("tableRows").innerHTML = queue.map((p) => {
      const s = huntSynopsis(p);
      return `<tr class="pick" data-id="${p.id}"><td><b>${esc(p.title)}</b><br><span style="color:#98a0b3">r/${esc(p.sub)} · ${esc(p.author)}</span></td><td>${esc(s.who)}</td><td>${esc(s.wants)}</td><td>${esc(s.country || "—")}</td><td>${ago(p.created || p.firstSeen)}</td><td>${p.score}</td></tr>`;
    }).join("") || `<tr><td colspan="6" style="color:#98a0b3">Nobody waiting yet.</td></tr>`;
    for (const tr of $("tableRows").querySelectorAll("tr.pick")) {
      tr.onclick = () => {
        const i = queue.findIndex((x) => x.id === tr.dataset.id);
        if (i >= 0) { queue = [queue[i], ...queue.filter((_, j) => j !== i)]; cur = queue[0]; variant = 0; }
        $("table").hidden = true; $("main").hidden = false; render();
      };
    }
    return;
  }
  send({ type: "hunt-contacted" }).then((r) => {
    const all = (r && r.rows) || [];
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const rows = kind === "today" ? all.filter((c) => c.at >= midnight.getTime()) : all;
    $("tableTitle").textContent = (kind === "today" ? "Contacted today" : "Contacted ever") + ` (${rows.length})`;
    $("tableNote").textContent = "This is the database. It lives inside the extension, nothing is downloaded, and everyone on it is permanently blocked from the queue.";
    $("tableHead").innerHTML = "<tr><th>Person</th><th>How</th><th>Where</th><th>When</th></tr>";
    $("tableRows").innerHTML = rows.length
      ? rows.map((c) => `<tr><td>${esc(c.user)}</td><td>${esc(c.how)}</td><td>r/${esc(c.sub || "?")}</td><td>${new Date(c.at).toLocaleString()}</td></tr>`).join("")
      : `<tr><td colspan="4" style="color:#98a0b3">Nobody yet. Everyone you reply to or DM lands here.</td></tr>`;
  });
}
$("sQueueBtn").onclick = () => showTable("queue");
$("sTodayBtn").onclick = () => showTable("today");
$("sEverBtn").onclick = () => showTable("ever");
$("closeTable").onclick = () => { $("table").hidden = true; $("main").hidden = false; refresh(); };
$("tableFind").oninput = () => {
  const q = $("tableFind").value.toLowerCase();
  for (const tr of $("tableRows").querySelectorAll("tr")) tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
};

// ---- never walk into a thread you are already in ------------------------
let checkingAhead = false;
async function checkAhead(n = 4) {
  if (checkingAhead) return;
  checkingAhead = true;
  try {
    for (const item of queue.slice(0, n)) {
      const r = await send({ type: "hunt-check-mine", id: item.id });
      if (!r || !r.mine) continue;
      const wasCurrent = cur && cur.id === item.id;
      queue = queue.filter((x) => x.id !== item.id);
      if (wasCurrent) { cur = queue[0] || null; variant = 0; $("sPoll").textContent = `you already replied to ${item.author} — skipped`; }
      render();
    }
  } finally { checkingAhead = false; }
}

document.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(e.target.tagName || "")) return;
  if (e.key === "1") $("didReply").click();
  if (e.key === "2") $("didDm").click();
  if (e.key === "s") $("skip").click();
  if (e.key === "x") $("bad").click();
});

(async () => {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  profile = config.profile || {};
  $("cName").value = profile.name || ""; $("cRole").value = profile.role || "";
  $("cReddit").value = profile.reddit || ""; $("cWa").value = profile.whatsapp || ""; $("cTg").value = profile.telegram || "";
  const { hunt = {} } = await chrome.storage.local.get(["hunt"]);
  $("cSrv").value = (hunt.server || {}).url || ""; $("cSrvTok").value = (hunt.server || {}).token || "";
  if (!profile.name || !profile.reddit) $("setup").hidden = false;   // first run: ask once
  await refresh(false);
  checkAhead();
  setInterval(() => { refresh(true); checkAhead(); }, 20000);
})();
