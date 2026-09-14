// Co-founder hunt: one post at a time, a two-line public reply to pick, a DM in
// the length you want, then next. Nobody is ever shown twice.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

let queue = [];        // local working copy, so a skip advances instantly
let cur = null;        // the post on screen
let variant = 0;       // which of the public options is picked
let dmSize = "long";
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
  const also = (p.also || []).map((a) => `<a href="${esc(a.permalink)}" target="_blank" style="color:#8ab4ff">r/${esc(a.sub)}</a>`).join(", ");
  $("meta").innerHTML = `r/${p.sub} · ${esc(p.author)} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments · fit ${p.score} ${tags}${also ? ` · <span class="tag" title="the same person cross-posted; one card, the rest hidden">also in ${also}</span>` : ""}`;
  $("body").textContent = p.body || "(no body text)";

  // the reading of the post, under the post
  const s = huntSynopsis(p);
  const rows = [
    ["Who", s.who], ["Wants", s.wants], ["Country", s.country || "not stated"],
    ["Stage", s.stage || "not stated"], ["Money", s.money || "not stated"],
    ["Equity", s.equity], ["Traction", s.traction || s.revenue], ["Time", s.commit],
  ].filter(([, v]) => v);
  $("syn").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  const useAi = !!p.ai && engine() !== "templates";
  options = useAi ? [p.ai.public_reply] : huntShortOptions(p, profile, 1);
  variant = 0;
  $("opts").hidden = true;                       // one reply, no menu
  aiStatus(p);
  $("short").value = options[0] || "";
  for (const b of $("sizes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.s === dmSize);
  $("dm").value = useAi ? (p.ai["dm_" + dmSize] || p.ai.dm_long || p.ai.dm_short) : huntDM(p, profile, dmSize);
  $("dmState").textContent = useAi ? `written for this post by ${p.ai.model === "on-device" ? "Chrome" : "Claude"}` : "template";
  $("dmState").style.color = useAi ? "#7ee29a" : "#98a0b3";
  $("repliedMark").hidden = !p.repliedAt;
  $("dmMark").hidden = !p.dmAt;
  aiWrite(false);
}

// ---- AI: written for this exact post, once, then cached on the post ------
// Two engines: the Anthropic API (from the worker, with the user's key) or
// Chrome's built-in Gemini Nano (right here in the page, free, on-device).
let aiBusy = "";
let aiStart = 0;
let aiErr = {};
setInterval(() => { if (cur && aiBusy === cur.id) aiStatus(cur); }, 1000);
function engine() {
  const e = profile.aiEngine;
  if (e === "claude" || e === "chrome" || e === "templates") return e;
  return profile.apiKey ? "claude" : "templates";
}
async function chromeAvailability() {
  if (typeof LanguageModel === "undefined") return "unsupported";
  try { return await LanguageModel.availability(); } catch (_) { return "unavailable"; }
}
async function chromeWrite(p, onProgress) {
  const { system, user, schema } = huntAiPrompt(p, profile, { compact: true });
  const session = await LanguageModel.create({
    initialPrompts: [{ role: "system", content: system }],
    monitor(m) { m.addEventListener("downloadprogress", (e) => onProgress && onProgress(e.loaded)); },
  });
  try {
    // on-device generation is slow (a minute or two on a laptop); never wait forever
    const text = await Promise.race([
      session.prompt(user, { responseConstraint: schema }),
      new Promise((_, bad) => setTimeout(() => bad(new Error("Chrome's model took more than 3 minutes — try rewrite, or switch to the Anthropic API for this one")), 180000)),
    ]);
    return JSON.parse(text);
  } catch (e) {
    if (e && (e.name === "QuotaExceededError" || /quota|too (?:long|large)|context/i.test(String(e.message)))) throw new Error("this post is too long for Chrome's small model — use the Anthropic API for it");
    if (e instanceof SyntaxError) throw new Error("Chrome's model did not return valid JSON — press rewrite");
    throw e;
  } finally { if (session.destroy) session.destroy(); }
}
function aiStatus(p) {
  const el = $("aiState");
  const eng = engine();
  $("aiRedo").hidden = !(eng !== "templates" && p.ai);
  if (eng === "templates") { el.textContent = profile.aiEngine === "templates" ? "templates" : "templates — pick an engine under AI writing to have replies written to the post"; el.style.color = "#98a0b3"; return; }
  if (p.ai) { el.textContent = `written for this post by ${p.ai.model === "on-device" ? "Chrome, on-device" : "Claude"}${p.ai.cents ? " · " + p.ai.cents + "¢" : ""}${p.ai.why ? " · built around: " + p.ai.why : ""}`; el.style.color = "#7ee29a"; return; }
  if (aiBusy === p.id) { const s = Math.round((Date.now() - aiStart) / 1000); el.textContent = (eng === "chrome" ? `Chrome is writing for this post… ${s}s (on-device is slow, usually 1–2 min)` : `Claude is writing for this post… ${s}s`); el.style.color = "#e6c76b"; return; }
  if (aiErr[p.id]) { el.textContent = "AI failed: " + aiErr[p.id] + " — showing templates"; el.style.color = "#ff8a65"; return; }
  el.textContent = "";
}
async function aiWrite(force) {
  if (!cur) return;
  const eng = engine();
  if (eng === "templates") return;
  if (!force && (cur.ai || aiBusy === cur.id || aiErr[cur.id] || aheadBusy === cur.id)) return;
  if (eng === "claude" && !profile.apiKey) { aiErr[cur.id] = "no API key yet — paste one under AI writing, or pick Chrome built-in"; aiStatus(cur); return; }
  const id = cur.id, post = cur;
  aiBusy = id; aiStart = Date.now(); aiStatus(cur);
  let r;
  if (eng === "chrome") {
    try {
      const avail = await chromeAvailability();
      if (avail === "unsupported") throw new Error("this Chrome has no built-in model (need Chrome 138+; see AI writing)");
      if (avail === "unavailable") throw new Error("Chrome says the built-in model is unavailable on this machine");
      const out = await chromeWrite(post, (f) => { $("aiState").textContent = `downloading Chrome's model… ${Math.round(f * 100)}%`; });
      r = await send({ type: "hunt-ai-save", id, ai: out, model: "on-device" });
    } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  } else {
    r = await send({ type: "hunt-ai", id, force: !!force });
  }
  aiBusy = "";
  if (r && r.cancelled) {
    // Claude judged this person not a fit: drop the card, say why, move on
    queue = queue.filter((q) => q.id !== id);
    if (cur && cur.id === id) { cur = queue[0] || null; variant = 0; render(); $("sPoll").textContent = `AI cancelled ${post.author}: ${r.reason}`; }
    refresh(); aiWriteAhead();
    return;
  }
  if (r && r.ok) {
    delete aiErr[id];
    for (const q of queue) if (q.id === id) q.ai = r.ai;
    if (cur && cur.id === id) { cur.ai = r.ai; variant = 0; render(); }
    aiWriteAhead();
  } else {
    const err = (r && r.error) || "no answer";
    if (cur && cur.id === id && cur.ai) { $("aiState").textContent = "rewrite failed: " + err + " — keeping the earlier one"; $("aiState").style.color = "#ff8a65"; return; }
    aiErr[id] = err;
    if (cur && cur.id === id) aiStatus(cur);
  }
}
// The next post gets written while you work on this one, so "next" is instant.
let aheadBusy = "";
async function aiWriteAhead() {
  const eng = engine();
  if (eng === "templates" || (eng === "claude" && !profile.apiKey)) return;
  const nxt = queue.find((q) => q !== cur && !q.ai && !aiErr[q.id] && !q.mine);
  if (!nxt || aheadBusy) return;
  aheadBusy = nxt.id;
  try {
    let r;
    if (eng === "chrome") { const out = await chromeWrite(nxt); r = await send({ type: "hunt-ai-save", id: nxt.id, ai: out, model: "on-device" }); }
    else r = await send({ type: "hunt-ai", id: nxt.id });
    if (r && r.cancelled) { queue = queue.filter((q) => q.id !== nxt.id); if (cur && cur.id === nxt.id) { cur = queue[0] || null; render(); } refresh(); }
    else if (r && r.ok) { for (const q of queue) if (q.id === nxt.id) q.ai = r.ai; if (cur && cur.id === nxt.id) { cur.ai = r.ai; variant = 0; render(); } }
    else aiErr[nxt.id] = (r && r.error) || "no answer";
  } catch (e) { aiErr[nxt.id] = String(e && e.message || e); }
  finally { aheadBusy = ""; }
}
$("aiRedo").onclick = () => aiWrite(true);

// ---- the AI writing panel ------------------------------------------------
$("openAi").onclick = () => { $("aiPanel").hidden = !$("aiPanel").hidden; if (!$("aiPanel").hidden) { $("setup").hidden = true; chromeStatus(); } };
async function chromeStatus() {
  const a = await chromeAvailability();
  $("chromeMsg").textContent = a === "available" ? "ready ✓ model is on this machine"
    : a === "downloadable" ? "not downloaded yet — click Check / download"
    : a === "downloading" ? "downloading…"
    : a === "unsupported" ? "not in this Chrome. Needs Chrome 138 or newer; if you have it, enable chrome://flags/#prompt-api-for-gemini-nano and restart"
    : "unavailable on this machine (needs ~22 GB free disk and a recent Chrome)";
}
$("chromeCheck").onclick = async () => {
  const a = await chromeAvailability();
  if (a === "downloadable" || a === "downloading") {
    $("chromeMsg").textContent = "downloading… 0%";
    try {
      const s = await LanguageModel.create({ monitor(m) { m.addEventListener("downloadprogress", (e) => { $("chromeMsg").textContent = `downloading… ${Math.round(e.loaded * 100)}%`; }); } });
      if (s.destroy) s.destroy();
    } catch (e) { $("chromeMsg").textContent = "download failed: " + String(e.message || e); return; }
  }
  chromeStatus();
};
for (const rb of document.querySelectorAll('input[name="engine"]')) {
  rb.onchange = async () => { profile.aiEngine = rb.value; await saveSetup(true); aiErr = {}; render(); };
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
  $("sBlocked").textContent = r.blocked + (r.later ? ` · ${r.later} later` : "") + (r.dupes ? ` · ${r.dupes} cross-posts folded` : "") + (r.aiCancelled ? ` · ${r.aiCancelled} cancelled by AI today` : "");
  $("sDoneToday").textContent = r.doneToday;
  const toGo = r.total;
  const pct = r.doneToday + toGo ? Math.round(100 * r.doneToday / (r.doneToday + toGo)) : 0;
  $("progText").textContent = `Today: ${r.doneToday} done · ${toGo} to go`;
  $("progFill").style.width = pct + "%";
  $("progSub").textContent = r.doneToday ? `${pct}% of what is in front of you · ${r.contactedToday} people contacted today${r.doneYesterday ? " · yesterday " + r.doneYesterday : ""}` : (r.doneYesterday ? `yesterday you did ${r.doneYesterday}` : "");
  const since = r.lastDone && r.doneYesterday ? `Yesterday you did ${r.doneYesterday} · ${r.newSince} new since` : r.lastDone ? `${r.newSince} new since your last one` : "";
  $("sSince").textContent = since; $("sSince").hidden = !since;
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
// Open the thread with the reply already sitting in Reddit's comment box.
$("goPost").onclick = async () => {
  if (!cur) return;
  const text = $("short").value;
  await copyText(text);                                   // fallback if the box cannot be found
  await chrome.storage.local.set({ pendingReply: { id: cur.id, permalink: cur.permalink, text, variant, at: Date.now() } });
  const path = cur.permalink.replace(/^https?:\/\/[^/]+/, "");
  window.open("https://www.reddit.com" + path, "_blank");   // new Reddit; prefill-new.js fills the composer there
};
$("goDm").onclick = async () => {
  if (!cur) return;
  await copyText($("dm").value);
  window.open(huntComposeUrl(cur, $("dm").value), "_blank");
  if ($("assumeDm").checked) setTimeout(() => act("dm"), 800);   // counts as sent; the post is struck through in Done and never returns
};
$("assumeDm").onchange = () => chrome.storage.local.set({ assumeDm: $("assumeDm").checked });
$("later").onclick = () => act("later");
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
$("openSetup").onclick = () => { $("setup").hidden = !$("setup").hidden; if (!$("setup").hidden) $("aiPanel").hidden = true; };
// Saves itself. No Save button to forget, no half-filled form.
let saveTimer = null;
async function saveSetup(quiet) {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  profile = { ...(config.profile || {}), name: $("cName").value.trim(), role: $("cRole").value.trim(), reddit: $("cReddit").value.trim().replace(/^\/?u\//, ""), whatsapp: $("cWa").value.trim(), telegram: $("cTg").value.trim(), linkedin: $("cLi").value.trim(), booking: $("cBook").value.trim(), portfolio: $("cPort").value.trim(), location: $("cLoc").value.trim(), apiKey: $("cKey").value.trim(), aiEngine: profile.aiEngine || "" };
  await chrome.storage.local.set({ config: { ...config, profile } });
  await send({ type: "hunt-me", me: profile.reddit });
  await send({ type: "hunt-server", url: $("cSrv").value.trim(), token: $("cSrvTok").value.trim() });
  if (!quiet) { $("setupMsg").textContent = "Saved ✓"; setTimeout(() => { $("setupMsg").textContent = "Saves itself as you type."; }, 1400); }
  render();
}
$("testKey").onclick = async () => {
  await saveSetup(true);
  $("keyMsg").textContent = "checking…";
  const r = await send({ type: "hunt-ai-test" });
  $("keyMsg").textContent = r && r.ok ? "key works ✓" : "key failed: " + ((r && r.error) || "no answer");
  if (r && r.ok && !profile.aiEngine) { profile.aiEngine = "claude"; await saveSetup(true); for (const rb of document.querySelectorAll('input[name="engine"]')) rb.checked = rb.value === "claude"; aiErr = {}; render(); }
};
for (const id of ["cName", "cRole", "cReddit", "cWa", "cTg", "cLoc", "cLi", "cBook", "cPort", "cKey", "cSrv", "cSrvTok"]) {
  $(id).addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSetup(false), 700); });
  $(id).addEventListener("blur", () => saveSetup(true));
}
$("showAdv").onclick = () => { $("adv").hidden = !$("adv").hidden; };

// ---- the deal: one dropdown, everything downstream follows it -------------
for (const m of DEAL_MODES) { const o = document.createElement("option"); o.value = m.key; o.textContent = m.label; $("cDeal").appendChild(o); }
function dealLoad() {
  const d = profile.deal || DEAL_DEFAULT;
  $("cDeal").value = DEAL_MODES.some((m) => m.key === d.mode) ? d.mode : "split";
  $("cUp").value = d.upfront; $("cShare").value = d.share; $("cExp").value = d.expenseShare; $("cNums").checked = !!d.numbersInDm;
  dealShow();
}
function dealRead() {
  return { ...(profile.deal || DEAL_DEFAULT), mode: $("cDeal").value, numbersInDm: $("cNums").checked, upfront: Number($("cUp").value) || DEAL_DEFAULT.upfront, share: Math.min(100, Number($("cShare").value) || DEAL_DEFAULT.share), expenseShare: Math.min(100, Number($("cExp").value) || DEAL_DEFAULT.expenseShare) };
}
function dealShow() {
  const sh = dealShape(dealRead());
  $("cUpWrap").hidden = !sh.hasUpfront;
  $("cShareWrap").hidden = sh.mode === "upfront";
  $("cExpWrap").hidden = sh.mode !== "split" && sh.mode !== "upfront_share";
  $("dealPreview").textContent = `In the first DM: "…we come in as your team and ${sh.shape}." Then: "${sh.question}" · In the inbox, when they ask: ${sh.terms}`;
}
let dealTimer = 0;
async function dealSave() {
  profile.deal = dealRead();
  dealShow();
  await send({ type: "inbox-terms", deal: profile.deal });
  // Everything already written used the old deal: drop it and write again for the card in front of you.
  for (const q of queue) delete q.ai;
  aiErr = {};
  if (cur) { delete cur.ai; variant = 0; render(); }
  $("setupMsg").textContent = "Deal saved ✓ — rewriting the replies";
  setTimeout(() => { $("setupMsg").textContent = "Saves itself as you type."; }, 1800);
}
$("cDeal").onchange = dealSave;
$("cNums").onchange = dealSave;
for (const id of ["cUp", "cShare", "cExp"]) {
  $(id).addEventListener("input", () => { dealShow(); clearTimeout(dealTimer); dealTimer = setTimeout(dealSave, 900); });
}

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
    tableText = () => queue.map((p) => { const s = huntSynopsis(p); return `${p.title}  [r/${p.sub} · ${p.role} · ${s.who} · ${s.country || "?"} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments]`; }).join("\n");
    $("tableRows").innerHTML = (queue.map((p) => {
      const s = huntSynopsis(p);
      return `<tr class="pick" data-id="${p.id}"><td><b>${esc(p.title)}</b><br><span style="color:#98a0b3">r/${esc(p.sub)} · ${esc(p.author)}</span></td><td>${esc(s.who)}</td><td>${esc(s.wants)}</td><td>${esc(s.country || "—")}</td><td>${ago(p.created || p.firstSeen)}</td><td>${p.score}</td></tr>`;
    }).join("") || `<tr><td colspan="6" style="color:#98a0b3">Nobody waiting yet.</td></tr>`) + `<tr id="doneRowsAnchor"></tr>`;
    // today's finished ones stay in the list, struck through, so the day's work is visible
    send({ type: "hunt-done" }).then((r) => {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const done = ((r && r.rows) || []).filter((d) => d.at >= midnight.getTime());
      const anchor = $("doneRowsAnchor"); if (!anchor) return;
      anchor.outerHTML = done.length ? `<tr><td colspan="6" style="color:#98a0b3;padding-top:14px">Done today — ${done.length}</td></tr>` + done.map((d) => `<tr class="done"><td><b>${esc(d.title)}</b><br><span style="color:#98a0b3">r/${esc(d.sub)} · ${esc(d.author)}</span></td><td class="mark">${d.repliedAt ? "reply ✓" : ""}</td><td class="mark">${d.dmAt ? "DM ✓" : ""}</td><td></td><td class="when">${new Date(d.at).toLocaleTimeString()}</td><td></td></tr>`).join("") : "";
      $("tableTitle").textContent = `Queue (${queue.length}) · done today ${done.length}`;
    });
    for (const tr of $("tableRows").querySelectorAll("tr.pick")) {
      tr.onclick = () => {
        const i = queue.findIndex((x) => x.id === tr.dataset.id);
        if (i >= 0) { queue = [queue[i], ...queue.filter((_, j) => j !== i)]; cur = queue[0]; variant = 0; }
        $("table").hidden = true; $("main").hidden = false; render();
      };
    }
    return;
  }
  if (kind === "done") {
    send({ type: "hunt-done" }).then((r) => {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const all = (r && r.rows) || [];
      let showToday = true;
      const draw = () => {
        const rows = showToday ? all.filter((d) => d.at >= midnight.getTime()) : all;
        $("tableTitle").textContent = `Done ${showToday ? "today" : "ever"} (${rows.length})`;
        $("tableNote").innerHTML = `Replied or DM'd. Struck through, on the contacted list, never shown again. <a href="#" id="doneToggle" style="color:#8ab4ff">${showToday ? "show all days" : "show today only"}</a>`;
        $("doneToggle").onclick = (e) => { e.preventDefault(); showToday = !showToday; draw(); };
        $("tableHead").innerHTML = "<tr><th>Post</th><th>Person</th><th>Reply</th><th>DM</th><th class='when'>When</th></tr>";
        tableText = () => rows.map((d) => `${d.title}  [${d.author} · ${d.repliedAt ? "replied" : ""}${d.dmAt ? " dm" : ""} · ${new Date(d.at).toLocaleString()}]`).join("\n");
        $("tableRows").innerHTML = rows.length ? rows.map((d) => `<tr class="done"><td><a href="${esc(d.permalink)}" target="_blank" style="color:inherit">${esc(d.title)}</a><br><span style="color:#98a0b3">r/${esc(d.sub)}</span></td><td>${esc(d.author)}</td><td>${d.repliedAt ? "✓" : "—"}</td><td>${d.dmAt ? "✓" : "—"}</td><td class="when">${new Date(d.at).toLocaleTimeString()}${showToday ? "" : " · " + new Date(d.at).toLocaleDateString()}</td></tr>`).join("")
          : `<tr><td colspan="5" style="color:#98a0b3">${showToday ? "Nothing yet today." : "Nothing yet."}</td></tr>`;
      };
      draw();
    });
    return;
  }
  send({ type: "hunt-contacted" }).then((r) => {
    const all = (r && r.rows) || [];
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const rows = kind === "today" ? all.filter((c) => c.at >= midnight.getTime()) : all;
    $("tableTitle").textContent = (kind === "today" ? "Contacted today" : "Contacted ever") + ` (${rows.length})`;
    $("tableNote").textContent = "This is the database. It lives inside the extension, nothing is downloaded, and everyone on it is permanently blocked from the queue.";
    $("tableHead").innerHTML = "<tr><th>Person</th><th>How</th><th>Where</th><th>When</th></tr>";
    tableText = () => rows.map((c) => `${c.user}  ${c.how}  r/${c.sub || "?"}  ${new Date(c.at).toLocaleString()}`).join("\n");
    $("tableRows").innerHTML = rows.length
      ? rows.map((c) => `<tr><td>${esc(c.user)}</td><td>${esc(c.how)}</td><td>r/${esc(c.sub || "?")}</td><td>${new Date(c.at).toLocaleString()}</td></tr>`).join("")
      : `<tr><td colspan="4" style="color:#98a0b3">Nobody yet. Everyone you reply to or DM lands here.</td></tr>`;
  });
}
$("sQueueBtn").onclick = () => showTable("queue");
$("sTodayBtn").onclick = () => showTable("today");
$("sEverBtn").onclick = () => showTable("ever");
$("sDoneBtn").onclick = () => showTable("done");
// Everything in the table as plain text on the clipboard: the fastest way to
// show someone what the hunt is finding, without a file.
let tableText = () => "";
$("copyTable").onclick = () => copyText(tableText(), $("copyTable"));
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

// ---- Update now: runs update.sh on your machine through the native host and
// shows every line it prints, as a strip. Needs the one-time registration.
const HOST = "com.redditleadthreads.updater";
function updShow(title, pct, cls) { if ($("upd").hidden) updBackground(); $("upd").hidden = false; $("updTitle").textContent = title; $("updFill").style.width = pct + "%"; $("upd").querySelector(".bar").className = "bar " + (cls || ""); }
function updLine(t) { const el = $("updLog"); el.textContent += (el.textContent ? "\n" : "") + t; el.scrollTop = el.scrollHeight; }
function updConnectCmd() { return `cd "$HOME/Downloads/reddit-heat-extension 7" && ./update.sh && ./autoupdate-install.sh ${chrome.runtime.id}`; }
function hostPort(cmd) {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return resolve({ error: String(e.message || e), missing: true }); }
    const got = [];
    port.onMessage.addListener((m) => { got.push(m); if (typeof onHostMessage === "function") onHostMessage(m); });
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      if (!got.length && err) return resolve({ error: err, missing: /not found|Specified native messaging host|forbidden/i.test(err) });
      resolve({ messages: got });
    });
    port.postMessage({ cmd });
  });
}
let onHostMessage = null;
$("updNow").onclick = async () => {
  $("updLog").textContent = ""; $("updConnect").hidden = true;
  updShow("Updating…", 5, "");
  onHostMessage = (m) => {
    if (m.line !== undefined) {
      updLine(m.line);
      if (/Downloading/.test(m.line)) updShow("Downloading from GitHub…", 35, "");
      if (/Now on:/.test(m.line) && $("updLog").textContent.split("Now on:").length > 2) updShow("Copying files…", 75, "");
    }
    if (m.done) {
      if (m.code === 0) { updShow(`Files on disk: v${m.onDisk}. Reloading the extension…`, 100, "ok"); setTimeout(showVersion, 800); }
      else updShow("Update failed — see the log below", 100, "bad");
      updBackground();
    }
  };
  const r = await hostPort("update");
  onHostMessage = null;
  if (r.error) {
    updShow(r.missing ? "One-time setup needed" : "Could not run the updater", 100, "bad");
    updLine(r.error);
    $("updConnect").hidden = false;
    $("updCmd").textContent = updConnectCmd();
  }
};
$("updCopy").onclick = () => copyText(updConnectCmd(), $("updCopy"));
$("updClose").onclick = () => { $("upd").hidden = true; };
// what the background updater is doing, from the machine itself
async function updBackground() {
  const r = await hostPort("status");
  const s = r.messages && r.messages.find((m) => m.status);
  if (!s) { $("updBg").textContent = ""; return; }
  $("updBg").textContent = `Background updater: ${s.scheduler === "off" ? "OFF — run the command above once and it turns on" : s.scheduler + ", every 2 min"} · folder has v${s.onDisk}${s.lastLog ? " · last log: " + s.lastLog : ""}`;
}

// ---- version: running, on disk, on GitHub -------------------------------
// Nothing to click. The 2-minute updater puts new files in the folder, the
// worker reloads the extension within a minute of that, and this pill just
// narrates it. If GitHub stays ahead for too long, the updater is not running.
let remoteAheadSince = 0;
async function showVersion() {
  const v = await send({ type: "version-state" });
  if (!v) return;
  const el = $("ver");
  el.className = "stat";
  if (v.diskAhead) {
    el.textContent = `v${v.onDisk} downloaded · reloading…`;
    el.className = "stat go";
    el.title = v.busy ? "a sweep is running; it reloads when that finishes" : "";
    // do not wait for the worker's minute tick; nothing on this page is lost, the queue lives in storage
    if (!v.busy && !document.querySelector("textarea:focus")) { await send({ type: "reload-now" }); setTimeout(() => location.reload(), 1500); }
    return;
  }
  if (v.remoteAhead) {
    remoteAheadSince = remoteAheadSince || Date.now();
    const waited = Math.round((Date.now() - remoteAheadSince) / 60000);
    if (waited >= 6) {
      el.textContent = `v${v.remote} is out but nothing arrived in ${waited} min — automatic updates are off. Click Update now`;
      el.className = "stat hot";
      el.title = "the background updater is not running on this machine";
    } else {
      el.textContent = `v${v.remote} is out · arriving in the background (≤2 min)`;
      el.className = "stat hot";
      el.title = "the updater fetches it, then the extension reloads itself; nothing to do";
    }
    return;
  }
  remoteAheadSince = 0;
  el.textContent = `v${v.running} · latest`;
  el.title = v.remoteCheckedAt ? "GitHub checked " + ago(v.remoteCheckedAt) + " · updates happen by themselves" : "GitHub not checked yet";
}
$("ver").onclick = async () => {
  const v = await send({ type: "version-state" });
  if (v && v.diskAhead) { await send({ type: "reload-now" }); setTimeout(() => location.reload(), 1200); }
  else { await send({ type: "version-check-now" }); showVersion(); }
};

function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("theme").textContent = t === "light" ? "☾ dark" : "☀ light"; }
$("theme").onclick = async () => { const t = document.body.classList.contains("light") ? "dark" : "light"; await chrome.storage.local.set({ theme: t }); applyTheme(t); };
chrome.storage.local.get(["theme"]).then(({ theme = "dark" }) => applyTheme(theme));

// the Inbox lives in its own tab; here only the count
async function inboxBadge() { const r = await send({ type: "inbox-list" }); if (r) { $("sInbox").textContent = r.needs; $("openInbox").classList.toggle("hot", r.needs > 0); } }
$("openInbox").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("inbox.html") });

document.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(e.target.tagName || "")) return;
  if (e.key === "1") $("didReply").click();
  if (e.key === "2") $("didDm").click();
  if (e.key === "s") $("skip").click();
  if (e.key === "x") $("bad").click();
  if (e.key === "l") $("later").click();
});

(async () => {
  const { config = {}, inbox = {} } = await chrome.storage.local.get(["config", "inbox"]);
  profile = config.profile || {};
  profile.deal = { ...DEAL_DEFAULT, ...(inbox.deal || {}) };
  dealLoad();
  $("cName").value = profile.name || ""; $("cRole").value = profile.role || "";
  $("cReddit").value = profile.reddit || ""; $("cWa").value = profile.whatsapp || ""; $("cTg").value = profile.telegram || "";
  $("cKey").value = profile.apiKey || "";
  $("cLi").value = profile.linkedin || ""; $("cBook").value = profile.booking || ""; $("cPort").value = profile.portfolio || ""; $("cLoc").value = profile.location || "";
  const eng = engine();
  for (const rb of document.querySelectorAll('input[name="engine"]')) rb.checked = rb.value === eng;
  chromeStatus();
  const { hunt = {} } = await chrome.storage.local.get(["hunt"]);
  $("cSrv").value = (hunt.server || {}).url || ""; $("cSrvTok").value = (hunt.server || {}).token || "";
  if (!profile.name || !profile.reddit) $("setup").hidden = false;   // first run: ask once
  const { assumeDm = true } = await chrome.storage.local.get(["assumeDm"]);
  $("assumeDm").checked = assumeDm !== false;
  // fill in what we can work out ourselves, so there is less to type
  if (!profile.reddit) {
    const who = await send({ type: "hunt-whoami" });
    if (who && who.me) {
      $("cReddit").value = who.me;
      if (!$("cName").value) $("cName").value = huntName(who.me) === "there" ? "" : huntName(who.me);
      await saveSetup(true);
    } else {
      $("cReddit").placeholder = "type it, e.g. Noah_Basera";
    }
  }
  await refresh(false);
  checkAhead();
  showVersion();
  updBackground();
  inboxBadge();
  setInterval(inboxBadge, 20000);
  setInterval(() => { refresh(true); checkAhead(); }, 20000);
  setInterval(showVersion, 15000);
})();
