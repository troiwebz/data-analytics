// Co-founder hunt: one post at a time, a two-line public reply to pick, a DM in
// the length you want, then next. Nobody is ever shown twice.
const $ = (id) => document.getElementById(id);
// what kind of lead this is, in one word, in its own colour
function badgeTag(p) {
  const d = badgeDef((p && p.badge) || "cofounder");
  return `<span class="bdg" style="background:${d.colour}22;color:${d.colour};border:1px solid ${d.colour}55" title="${d.note}">${d.label}</span>`;
}
// Every number on this page comes from the worker. When the worker is not
// answering, the page used to sit at its HTML defaults - "In queue 0",
// "never checked", "v?" - which reads exactly like losing all your data.
// It is not: the database is in chrome.storage and is untouched. So: one
// retry in case the worker is only asleep, then say so, loudly.
let workerDown = "";
const sendOnce = (msg) => new Promise((r) => {
  try {
    chrome.runtime.sendMessage(msg, (out) => {
      const e = chrome.runtime.lastError;      // read it, or Chrome logs it as unchecked
      r(e ? { __down: e.message || "no answer from the background" } : out);
    });
  } catch (e) { r({ __down: String((e && e.message) || e) }); }
});
const send = async (msg) => {
  let out = await sendOnce(msg);
  if (out && out.__down) {                     // asleep? sendMessage wakes it; give it a moment
    await new Promise((r) => setTimeout(r, 600));
    out = await sendOnce(msg);
  }
  if (out && out.__down) { workerSays(out.__down); return undefined; }
  if (workerDown) workerSays("");
  return out;
};
function workerSays(err) {
  workerDown = err;
  const box = $("dead");
  if (!box) return;
  box.hidden = !err;
  if (err) { $("deadWhy").textContent = err; deadFacts(); }
}
// Proof, not reassurance: this page can read chrome.storage itself, so it
// counts the database in front of you while the worker is still down.
async function deadFacts() {
  try {
    const { hunt = {}, inbox = {} } = await chrome.storage.local.get(["hunt", "inbox"]);
    const posts = Object.values(hunt.posts || {});
    if (!posts.length && !Object.keys(hunt.contacted || {}).length) {
      $("deadData").textContent = "Storage really is empty, so this one is not just the worker. Restore your last backup under Your details.";
      $("deadData").style.color = "#ff8a65";
      return;
    }
    const open = posts.filter((x) => !x.act && !x.repliedAt && !x.dmAt).length;
    $("deadData").style.color = "#7ee29a";
    const many = (n, one, lots) => `${n} ${n === 1 ? one : lots}`;
    $("deadData").textContent = `Read straight from storage just now: ${many(posts.length, "post", "posts")} held, ${open} of them still open, `
      + `${many(Object.keys(hunt.contacted || {}).length, "person", "people")} contacted, ${many(Object.keys(inbox.threads || {}).length, "chat thread", "chat threads")}, `
      + `last check ${hunt.lastPoll ? new Date(hunt.lastPoll).toLocaleString() : "never"}. Nothing is lost.`;
  } catch (e) { $("deadData").textContent = "Could not read storage: " + ((e && e.message) || e); }
}
// the script tag sits at the end of the body, so the banner is already there
$("deadHow").onclick = () => { $("deadSteps").hidden = !$("deadSteps").hidden; };
// the same file the normal backup button writes, built here without the worker
$("deadSave").onclick = async () => {
  try {
    const { hunt = {}, inbox = {}, config = {}, spend = {} } = await chrome.storage.local.get(["hunt", "inbox", "config", "spend"]);
    const profile = { ...(config.profile || {}) };
    delete profile.apiKey;                       // the key stays out of the file, dead worker or not
    const data = { v: 1, at: Date.now(),
      counts: { posts: Object.keys(hunt.posts || {}).length, contacted: Object.keys(hunt.contacted || {}).length, threads: Object.keys(inbox.threads || {}).length },
      hunt: { posts: hunt.posts || {}, contacted: hunt.contacted || {}, found: hunt.found || 0, me: hunt.me || "", subs: hunt.subs, maxAgeH: hunt.maxAgeH, sent: hunt.sent || [] },
      inbox: { threads: inbox.threads || {}, plan: inbox.plan || "", deal: inbox.deal || null, me: inbox.me || "" },
      profile, spendDays: spend.days || {} };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `cofounder-hunt-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("deadSave").textContent = `saved ${data.counts.posts} posts, ${data.counts.contacted} people`;
  } catch (e) { $("deadSave").textContent = "could not read storage"; }
};
$("deadReload").onclick = () => {
  $("deadReload").textContent = "reloading…"; $("deadReload").disabled = true;
  try { chrome.runtime.reload(); } catch (_) { /* the page dies with it; that is the point */ }
  setTimeout(() => location.reload(), 1200);
};

let daySpend = { cents: 0, budget: 100 };   // what today has cost, for the line under the buttons
let openRow = "";         // the row showing its synopsis
let picked = new Set();   // rows ticked in the table
let queue = [];        // what is in front of you: filtered and sorted
let allQueue = [];     // everything the worker sent, before the view
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
// money in dollars, with enough decimals to be readable at these sizes
function usd(cents) {
  const d = (Number(cents) || 0) / 100;
  return "$" + (d >= 0.1 ? d.toFixed(2) : d >= 0.001 ? d.toFixed(3) : d.toFixed(4));
}

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
  $("meta").innerHTML = `${badgeTag(p)} r/${p.sub} · ${esc(p.author)}${p.kind ? " · " + esc(p.kind) : ""}${p.budget ? " · " + esc(p.budget) : ""} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments · fit ${p.score} ${tags}${also ? ` · <span class="tag" title="the same person cross-posted; one card, the rest hidden">also in ${also}</span>` : ""}`;
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
  // a reply cached by an older version was two lines; those become one short line
  const cachedLine = useAi && p.ai.public_reply && !/\n/.test(p.ai.public_reply) ? p.ai.public_reply : "";
  options = [cachedLine || huntShortOptions(p, profile, 1)[0]];
  pubShow(p);
  variant = 0;
  $("opts").hidden = true;                       // one reply, no menu
  aiStatus(p);
  for (const b of $("sizes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.s === dmSize);
  $("dm").value = useAi ? (p.ai["dm_" + dmSize] || p.ai.dm_long || p.ai.dm_short) : huntDM(p, profile, dmSize);
  $("dmState").textContent = useAi ? `written for this post by ${p.ai.model === "on-device" ? "Chrome" : "Claude"}` : "template";
  $("dmState").style.color = useAi ? "#7ee29a" : "#98a0b3";
  $("repliedMark").hidden = !p.repliedAt;
  $("dmMark").hidden = !p.dmAt;
  const eng2 = engine();
  const paid = eng2 === "slots" || eng2 === "claude";
  $("genRow").hidden = !(paid && !p.ai);
  $("genAi").textContent = "Write the DM with Claude";
  $("genNote").textContent = paid && !p.ai
    ? (profile.apiKey ? "about $0.005 · the template above is free" : "paste your API key under AI writing first")
    : "";
  costShow(p);
  if (profile.autoWrite && paid) aiWrite(false);            // only if you asked for that
  else if (eng2 === "chrome" && profile.autoWrite) aiWrite(false);
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
  if (e === "claude" || e === "chrome" || e === "templates" || e === "paste" || e === "slots") return e;
  return profile.apiKey ? "slots" : "templates";   // with a key, every answer is written for the post
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
  $("dmRedo").hidden = !(eng !== "templates" && p.ai);
  $("pasteTools").hidden = eng !== "paste";
  if (eng === "templates") { el.textContent = profile.aiEngine === "templates" ? "templates" : "templates — pick an engine under AI writing to have replies written to the post"; el.style.color = "#98a0b3"; return; }
  if (eng === "paste" && !p.ai) { el.textContent = "template shown — copy the brief, paste it into Claude in Chrome, paste the answer back"; el.style.color = "#98a0b3"; return; }
  if (p.ai) {
    const c = p.ai.concept;
    el.textContent = `written for this post by ${p.ai.model === "on-device" ? "Chrome, on-device" : p.ai.model === "claude-chrome" ? "Claude in Chrome" : p.ai.model === "template+slots" ? `Claude into your blueprint · ${p.ai.style} shape${p.ai.overlap !== undefined ? ` · ${Math.round(p.ai.overlap * 100)}% like your recent ones` : ""}` : "Claude"}${p.ai.polished ? " + polished" : ""}${p.ai.cents ? " · " + usd(p.ai.cents) : ""}${c && c.product ? " · about: " + c.product + (c.type ? " (" + c.type.replace("_", " ") + ")" : "") : p.ai.why ? " · built around: " + p.ai.why : ""}${p.ai.quoted && p.ai.quoted.length ? " · quotes them: “" + p.ai.quoted[0] + "”" : ""}`;
    el.style.color = p.ai.generic ? "#e6c76b" : "#7ee29a";
    if (p.ai.generic) el.textContent += " · none of their words quoted — read it before sending";
    // which channel the plan leads to, so you can see it before you send
    if (p.ai.channel) el.textContent += ` · plan leads to ${channelLabel(p.ai.channel) || p.ai.channel}${p.ai.channel_reason ? " (" + p.ai.channel_reason + ")" : ""}`;
    // both lengths are checked when they are written; say so, and say what failed
    const ck = Array.isArray(p.ai.checks) ? p.ai.checks : null;
    if (ck && ck.length) { el.textContent += " · CHECK: " + ck.join("; "); el.style.color = "#ff8a65"; }
    else if (ck) el.textContent += " · short and long both checked";
    return;
  }
  if (aiBusy === p.id) { const s = Math.round((Date.now() - aiStart) / 1000); el.textContent = (eng === "chrome" ? `Chrome is writing for this post… ${s}s (on-device is slow, usually 1–2 min)` : `Claude is writing for this post… ${s}s`); el.style.color = "#e6c76b"; return; }
  if (aiErr[p.id]) { el.textContent = "AI failed: " + aiErr[p.id] + " — showing templates"; el.style.color = "#ff8a65"; return; }
  // under "never drop anything" the doubt is kept and shown, not acted on
  if (p.ai && p.ai.fit === "no") { el.textContent = "Claude thinks this one is not a fit: " + (p.ai.fit_reason || "no reason given") + " — written anyway, your call"; el.style.color = "#e6c76b"; return; }
  el.textContent = "";
}
async function aiWrite(force) {
  if (!cur) return;
  const eng = engine();
  if (eng === "templates" || eng === "paste") return;
  if (!force && (cur.ai || aiBusy === cur.id || aiErr[cur.id] || aheadBusy === cur.id)) return;
  if (eng === "claude" && !profile.apiKey) { aiErr[cur.id] = "no API key yet — paste one under AI writing, or pick Chrome built-in"; aiStatus(cur); return; }
  const id = cur.id, post = cur;
  aiBusy = id; aiStart = Date.now(); aiStatus(cur);
  let r;
  if (eng === "slots") {
    r = await send({ type: "hunt-slots", id, force: !!force });
  } else if (eng === "chrome") {
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
    // Claude judged this person not a fit. The card moves on, so say so where
    // it cannot be missed: pressing the button and watching the post change is
    // indistinguishable from nothing happening.
    queue = queue.filter((q) => q.id !== id);
    dropped = { id, author: post.author, title: post.title, reason: r.reason };
    $("drop").hidden = false;
    $("dropWhy").textContent = ` u/${post.author || "?"} — “${r.reason}”. The post is in Set aside, with that reason.`;
    if (cur && cur.id === id) { cur = queue[0] || null; variant = 0; render(); }
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
  if (!profile.autoWrite) return;                            // no writing for cards you have not looked at
  if (eng === "templates" || eng === "paste" || (eng === "claude" && !profile.apiKey)) return;
  const nxt = queue.find((q) => q !== cur && !q.ai && !aiErr[q.id] && !q.mine);
  if (!nxt || aheadBusy) return;
  aheadBusy = nxt.id;
  try {
    let r;
    if (eng === "slots") r = await send({ type: "hunt-slots", id: nxt.id });
    else if (eng === "chrome") { const out = await chromeWrite(nxt); r = await send({ type: "hunt-ai-save", id: nxt.id, ai: out, model: "on-device" }); }
    else r = await send({ type: "hunt-ai", id: nxt.id });
    if (r && r.cancelled) { queue = queue.filter((q) => q.id !== nxt.id); if (cur && cur.id === nxt.id) { cur = queue[0] || null; render(); } refresh(); }
    else if (r && r.ok) { for (const q of queue) if (q.id === nxt.id) q.ai = r.ai; if (cur && cur.id === nxt.id) { cur.ai = r.ai; variant = 0; render(); } }
    else aiErr[nxt.id] = (r && r.error) || "no answer";
  } catch (e) { aiErr[nxt.id] = String(e && e.message || e); }
  finally { aheadBusy = ""; }
}
$("dmRedo").onclick = () => aiWrite(true);
$("genAi").onclick = () => { $("genRow").hidden = true; aiWrite(true); };

// ---- Claude in Chrome: copy the brief, paste the answer back ---------------
function briefFor(list) { return huntBrief(list, profile); }
$("copyBrief").onclick = () => { if (cur) copyText(briefFor([cur]), $("copyBrief")); };
$("copyBatch").onclick = () => {
  const list = queue.filter((q) => !q.ai && !q.mine).slice(0, 10);
  if (!list.length) { $("pasteMsg").textContent = "nothing waiting"; return; }
  copyText(briefFor(list), $("copyBatch"));
  $("pasteMsg").textContent = `${list.length} briefs copied — paste them into Claude in Chrome as one message`;
};
$("pasteOpen").onclick = () => { $("pasteBox").hidden = !$("pasteBox").hidden; if (!$("pasteBox").hidden) $("pasteText").focus(); };
$("pasteCancel").onclick = () => { $("pasteBox").hidden = true; };
$("pasteGo").onclick = async () => {
  const answers = huntParseAnswers($("pasteText").value);
  if (!answers.length) { $("pasteMsg").textContent = "could not find REPLY / DM SHORT / DM LONG in that text — paste Claude's whole answer"; return; }
  let filled = 0, cancelled = 0; const bad = [];
  for (const a of answers) {
    const id = a.id || (cur && cur.id);
    if (!id) continue;
    const r = await send({ type: "hunt-ai-save", id, ai: a.ai, model: "claude-chrome" });
    if (r && r.ok) { filled += 1; for (const q of queue) if (q.id === id) q.ai = r.ai; if (cur && cur.id === id) cur.ai = r.ai; }
    else if (r && r.cancelled) { cancelled += 1; queue = queue.filter((q) => q.id !== id); if (cur && cur.id === id) cur = queue[0] || null; }
    else bad.push(`${id}: ${(r && r.error) || "rejected"}`);
  }
  $("pasteMsg").textContent = `${filled} filled${cancelled ? ` · ${cancelled} cancelled as not a fit` : ""}${bad.length ? ` · rejected — ${bad.join("; ")}` : ""}`;
  if (filled || cancelled) { $("pasteText").value = ""; $("pasteBox").hidden = true; variant = 0; render(); refresh(); }
};

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
  $("sPoll").title = r.lastReport || "";
  // always reachable: the schedule is also the record of what was sent, and a
  // chip that disappears when nothing is waiting is a chip nobody can find
  $("schedChip").hidden = false;
  if (r.schedule) {
    const mins = Math.max(0, Math.round((r.scheduleNext - Date.now()) / 60000));
    $("schedChip").textContent = `Scheduled ${r.schedule} · next in ${mins}m`;
    $("schedChip").style.color = "";
  } else if (r.scheduleAll) {
    $("schedChip").textContent = `Schedule · ${r.scheduleSent} sent`;
    $("schedChip").style.color = "#7ee29a";
  } else {
    $("schedChip").textContent = "Schedule · nothing yet";
    $("schedChip").style.color = "#98a0b3";
  }
  // a bulk skip is undoable for an hour, by the batch, from the header
  const lb = r.lastBulk;
  const fresh30 = lb && lb.ids && lb.ids.length && Date.now() - lb.at < 3600000;
  $("undoBulk").hidden = !fresh30;
  if (fresh30) $("undoBulk").textContent = `Undo ${lb.ids.length} ${lb.action === "later" ? "parked" : lb.action === "not_relevant" ? "marked not relevant" : "skipped"} ${ago(lb.at)}`;
  $("undoReset").hidden = !(r.undoReset && Date.now() - r.undoReset < 86400000);
  if (!$("undoReset").hidden) $("undoReset").textContent = `Undo the reset · ${ago(r.undoReset)}`;
  $("sSkippedBtn").hidden = !r.skippedTotal;
  if (r.badges) { badgeCounts = r.badges; paintBadges(); }
  $("sRejectBtn").hidden = !r.rejectTotal;
  $("sReject").textContent = r.rejectTotal || 0;
  campChip();
  $("sSkipped").textContent = r.skippedTotal || 0;
  const days = r.lastBackupAt ? Math.floor((Date.now() - r.lastBackupAt) / 86400000) : 999;
  if (days >= 7 && (r.contactedTotal || 0) > 0) { $("backupWarn").hidden = false; $("backupWarn").textContent = r.lastBackupAt ? `No backup for ${days} days` : "Never backed up"; }
  else $("backupWarn").hidden = true;
  if (r.spend) { daySpend = r.spend; if (cur) costShow(cur); $("sSpend").textContent = `${usd(r.spend.cents)} / ${usd(r.spend.budget)}`; $("sSpendWrap").style.color = r.spend.cents >= r.spend.budget ? "#ff8a65" : ""; }
  if (r.lastReport && !r.lastError) $("scan").textContent = "Last check: " + r.lastReport; else if (!r.lastReport) $("scan").textContent = "";
  $("sPoll").style.color = r.lastError ? "#ff8a65" : "";
  $("hint").hidden = !r.lastError;
  for (const b of $("win").querySelectorAll("button")) b.classList.toggle("on", Number(b.dataset.h) === r.maxAgeH);
  $("toggle").textContent = r.on ? "Watching · stop" : "Start watching";
  $("toggle").className = r.on ? "" : "primary";

  const keepId = keepCurrent && cur ? cur.id : null;
  allQueue = r.queue;
  const fresh = applyView(allQueue);
  queue = keepId && fresh.some((x) => x.id === keepId)
    ? [fresh.find((x) => x.id === keepId), ...fresh.filter((x) => x.id !== keepId)]
    : fresh;
  const prevId = cur && cur.id;
  cur = queue[0] || null;
  if (!cur || cur.id !== prevId) variant = 0;
  render();
  // The table is the same data as the chips. When the window, a skip or a send
  // changes what is in the queue, redraw it too: otherwise it sits there
  // saying "Queue (3)" while the header says 16, and posts already done are
  // still listed as waiting.
  if (!$("table").hidden && tableKind && !tableDrawing) {
    tableDrawing = true;
    const find = $("tableFind").value;
    const y = window.scrollY;
    try {
      showTable(tableKind);
      if (find) { $("tableFind").value = find; $("tableFind").oninput(); }
      window.scrollTo(0, y);
    } finally { tableDrawing = false; }
  }
}

// ---- sort and filter: by age, country, wants, who, stage, money, a word ----
const VIEW_KEYS = ["qSort", "fCountry", "fWants", "fWho", "fStage", "fMoney", "fAge", "fFind"];
function viewGet() { const v = {}; for (const k of VIEW_KEYS) v[k] = $(k).value; return v; }
function viewSave() { try { localStorage.setItem("huntView", JSON.stringify(viewGet())); } catch (_) { /* fine */ } }
function viewLoad() { try { const v = JSON.parse(localStorage.getItem("huntView") || "{}"); for (const k of VIEW_KEYS) if (v[k] !== undefined && $(k)) $(k).value = v[k]; } catch (_) { /* fine */ } }
function moneyKey(p) { return p.equityOnly ? "equity" : p.hasBudget ? "budget" : "unknown"; }
function ageH(p) { return (Date.now() - (p.created || p.firstSeen || Date.now())) / 3600000; }
function applyView(list) {
  const v = viewGet();
  const find = v.fFind.trim().toLowerCase();
  // options for country and who come from what is actually in the queue
  // the filter works by country; the table still shows the city they named
  fillSelect("fCountry", list.map((p) => huntPlace(p).country).filter(Boolean), v.fCountry, "any country");
  fillSelect("fWho", list.map((p) => huntWho(p)), v.fWho, "anyone");
  let out = list.filter((p) => {
    const s = huntSynopsis(p);
    if (v.fCountry && huntPlace(p).country !== v.fCountry) return false;
    if (v.fWants && (p.role || "unclear") !== v.fWants) return false;
    if (v.fWho && s.who !== v.fWho) return false;
    if (v.fStage && (p.stage || "unknown") !== v.fStage) return false;
    if (v.fMoney && moneyKey(p) !== v.fMoney) return false;
    if (v.fAge === "old" ? ageH(p) <= 24 : v.fAge && ageH(p) > Number(v.fAge)) return false;
    if (find && !`${p.title} ${p.body} ${p.author} r/${p.sub} ${s.country} ${s.who}`.toLowerCase().includes(find)) return false;
    return true;
  });
  const roleOrder = { technical: 0, marketing: 1, design: 2, business: 3, unclear: 4 };
  const by = {
    fit: null,
    newest: (a, b) => (b.created || 0) - (a.created || 0),
    oldest: (a, b) => (a.created || 0) - (b.created || 0),
    fewest: (a, b) => (a.comments || 0) - (b.comments || 0),
    most: (a, b) => (b.comments || 0) - (a.comments || 0),
    country: (a, b) => (huntPlace(a).country || "zzz").localeCompare(huntPlace(b).country || "zzz"),
    wants: (a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9),
    who: (a, b) => huntWho(a).localeCompare(huntWho(b)),
  }[v.qSort];
  if (by) out = out.slice().sort(by);
  // a clicked column header wins over the Sort box
  if (badgeFilter) out = out.filter((p) => (p.badge || "cofounder") === badgeFilter);
  if (colSort.key && COL_SORT[colSort.key]) out = out.slice().sort((a, b) => COL_SORT[colSort.key](a, b) * colSort.dir);
  $("viewCount").textContent = out.length === list.length ? `${list.length} in front of you` : `showing ${out.length} of ${list.length}`;
  return out;
}
// ---- click a column to sort by it, click again to turn it round ----------
// Each one starts in the direction that is useful: the newest post, the best
// fit, A to Z for words. The arrow in the header says which way it is.
const COL_SORT = {
  post: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
  who: (a, b) => huntWho(a).localeCompare(huntWho(b)),
  wants: (a, b) => String(huntSynopsis(a).wants || "").localeCompare(String(huntSynopsis(b).wants || "")),
  country: (a, b) => (huntPlace(a).country || "zzz").localeCompare(huntPlace(b).country || "zzz"),
  age: (a, b) => (b.created || b.firstSeen || 0) - (a.created || a.firstSeen || 0),   // youngest first
  fit: (a, b) => (b.score || 0) - (a.score || 0),                                      // best first
};
let colSort = { key: "", dir: 1 };
try { const c = JSON.parse(localStorage.getItem("huntCols") || "null"); if (c && c.key) colSort = c; } catch (_) { /* fine */ }
function colClick(key) {
  if (colSort.key === key) colSort.dir = -colSort.dir;
  else colSort = { key, dir: 1 };
  try { localStorage.setItem("huntCols", JSON.stringify(colSort)); } catch (_) { /* fine */ }
  queue = applyView(allQueue);
  showTable("queue");
}
function colHead(key, label) {
  const on = colSort.key === key;
  const arrow = on ? (colSort.dir === 1 ? " \u25b2" : " \u25bc") : "";
  return `<th class="colsort" data-k="${key}" style="cursor:pointer;${on ? "color:var(--or)" : ""}" title="click to sort by ${label.toLowerCase()}, click again to reverse">${label}${arrow}</th>`;
}
function fillSelect(id, values, keep, anyLabel) {
  const el = $(id);
  const counts = {}; for (const x of values) counts[x] = (counts[x] || 0) + 1;
  const opts = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  el.innerHTML = `<option value="">${anyLabel}</option>` + opts.map((o) => `<option value="${esc(o)}">${esc(o)} (${counts[o]})</option>`).join("");
  el.value = opts.includes(keep) ? keep : "";
}
function viewChanged() {
  viewSave();
  queue = applyView(allQueue);
  cur = queue[0] || null; variant = 0;
  render();
  if (!$("table").hidden) showTable("queue");
}
viewLoad();
for (const k of VIEW_KEYS) $(k).addEventListener(k === "fFind" ? "input" : "change", viewChanged);
$("fClear").onclick = () => { for (const k of VIEW_KEYS) $(k).value = k === "qSort" ? "fit" : ""; viewChanged(); };

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

// What this one post has cost, next to what the whole day has cost: the two
// numbers that decide whether a habit is worth keeping.
function costShow(p) {
  const mine = (p.ai && p.ai.cents ? p.ai.cents : 0) + (p.guide && p.guide.cents ? p.guide.cents : 0);
  const parts = [];
  if (p.ai && p.ai.cents) parts.push(`the DM ${usd(p.ai.cents)}`);
  if (p.guide && p.guide.cents) parts.push(`the public reply ${usd(p.guide.cents)}`);
  $("costNote").textContent = mine
    ? `This post has cost ${usd(mine)} (${parts.join(" · ")}) · today ${usd(daySpend.cents)} of ${usd(daySpend.budget)}`
    : (daySpend.cents ? `Nothing spent on this post yet · today ${usd(daySpend.cents)} of ${usd(daySpend.budget)}` : "");
  $("costNote").style.color = daySpend.cents >= daySpend.budget ? "#ff8a65" : "#98a0b3";
}
// Two sizes of public reply in one box: the free one-liner, and the detailed
// answer Claude writes. The buttons under the box send whichever is shown.
let pubSize = "short";
try { pubSize = localStorage.getItem("huntPubSize") || "short"; } catch (_) { /* fine */ }
function pubShow(p) {
  for (const b of $("pubSizes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.p === pubSize);
  const g = p && p.guide;
  $("genGuide").hidden = !(pubSize === "long" && !g);
  $("aiRedo").hidden = !(pubSize === "long" && g);
  if (pubSize === "long") {
    $("short").value = g ? g.text : "";
    $("short").placeholder = "Nothing written yet. Press \u201cWrite the detailed one\u201d and Claude answers this thread properly: three to five numbered points, a question for them, then your line and the DM.";
    $("short").style.height = "260px";
    const bad = g && Array.isArray(g.checks) && g.checks.length;
    $("pubNote").textContent = g ? (bad ? "CHECK: " + g.checks.join("; ") : `written by Claude · ${usd(g.cents || 0)} · checked`) : "about $0.004";
    $("pubNote").style.color = bad ? "#ff8a65" : "#98a0b3";
  } else {
    $("short").value = options[0] || "";
    $("short").placeholder = "";
    $("short").style.height = "84px";
    $("pubNote").textContent = "free, written here, never repeated";
    $("pubNote").style.color = "#98a0b3";
  }
}
for (const b of $("pubSizes").querySelectorAll("button")) b.onclick = () => {
  pubSize = b.dataset.p;
  try { localStorage.setItem("huntPubSize", pubSize); } catch (_) { /* fine */ }
  if (cur) pubShow(cur);
};
$("genGuide").onclick = () => guideWrite(false);
$("aiRedo").onclick = () => guideWrite(true);
async function guideWrite(force) {
  if (!cur) return;
  const id = cur.id;
  const busy = force ? $("aiRedo") : $("genGuide");
  const was = busy.textContent;
  busy.disabled = true; busy.textContent = "writing…";
  const r = await send({ type: "hunt-guide", id, force: !!force });
  busy.disabled = false; busy.textContent = was;
  if (!r || !r.ok) {
    $("pubNote").textContent = "it failed: " + ((r && r.error) || "no answer");
    $("pubNote").style.color = "#ff8a65";
    return;
  }
  for (const q of queue) if (q.id === id) q.guide = r.guide;
  pubSize = "long";
  if (cur && cur.id === id) { cur.guide = r.guide; render(); }
  refresh(false);
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
// The DM button waits between sends, and stops for the day at your ceiling.
let gate = { ok: true, waitMs: 0, sentToday: 0, cap: 25 };
async function gateTick() {
  const g = await send({ type: "hunt-dm-gate" });
  if (g) gate = g;
  paintGate();
}
function paintGate() {
  const b = $("goDm");
  if (!b) return;
  const secs = Math.ceil(gate.waitMs / 1000);
  if (gate.sentToday >= gate.cap) { b.disabled = true; b.textContent = `DM limit for today reached (${gate.sentToday}/${gate.cap})`; }
  else if (secs > 0) { b.disabled = true; b.textContent = `Next DM in ${secs}s — pacing so Reddit doesn't flag you`; }
  else { b.disabled = false; b.textContent = "Open the DM, filled in ↗"; }
  const note = $("dmGateNote");
  if (note) note.textContent = `${gate.sentToday} of ${gate.cap} sent today${secs > 0 ? ` · next in ${secs}s` : ""}`;
}
setInterval(() => { if (gate.waitMs > 0) { gate.waitMs = Math.max(0, gate.waitMs - 1000); paintGate(); } }, 1000);
setInterval(gateTick, 15000);
gateTick();
$("goDm").onclick = async () => {
  if (!cur || $("goDm").disabled) return;
  await copyText($("dm").value);
  // Reddit's "new chat" page; the bridge types the name, opens the chat and fills the box. Nothing is sent by us.
  await chrome.storage.local.set({ pendingDm: { kind: "hunt", id: cur.id, author: cur.author, text: $("dm").value, at: Date.now() } });
  window.open("https://www.reddit.com/chat/room/create", "_blank");
  if ($("assumeDm").checked) setTimeout(async () => { await act("dm"); gateTick(); }, 800);   // counts as sent; the post is struck through in Done and never returns
  else setTimeout(gateTick, 1500);
};
$("assumeDm").onchange = () => chrome.storage.local.set({ assumeDm: $("assumeDm").checked });
$("later").onclick = () => act("later");
$("copyShort").onclick = () => copyText($("short").value, $("copyShort"));
$("copyDm").onclick = () => copyText($("dm").value, $("copyDm"));
for (const b of document.querySelectorAll("#sizes button")) b.onclick = () => { dmSize = b.dataset.s; render(); };
$("didReply").onclick = () => act("replied");
$("didDm").onclick = async () => { await act("dm"); gateTick(); };
$("skip").onclick = () => act("skip");
$("skipTop").onclick = () => act("skip");
$("badTop").onclick = () => act("not_relevant");
$("laterTop").onclick = () => act("later");
$("bad").onclick = () => act("not_relevant");
$("undo").onclick = async () => { if (lastActed) { await send({ type: "hunt-act", id: lastActed, action: "undo" }); lastActed = null; await refresh(false); } };
let scanTimer = 0;
async function scanTick() {
  const st = await send({ type: "hunt-scan-state" });
  const on = !!(st && st.running);
  $("scanLive").hidden = !on;
  $("scanStop").hidden = !on;
  $("now").disabled = on;
  $("now").textContent = on ? "Scanning…" : "Scan now";
  if (on) {
    $("scanLive").textContent = `${st.where || "…"} · ${st.done} of ${st.total} · ${st.seen.toLocaleString()} posts read · ${st.found} new`;
    clearTimeout(scanTimer); scanTimer = setTimeout(scanTick, 900);
  }
}
$("scanStop").onclick = async () => { $("scanStop").textContent = "stopping…"; await send({ type: "hunt-scan-stop" }); setTimeout(() => { $("scanStop").textContent = "Stop"; }, 1500); };
scanTick();
setInterval(scanTick, 5000);
$("now").onclick = async () => {
  $("now").textContent = "Scanning…"; $("now").disabled = true;
  scanTick();
  try {
    const r = await Promise.race([send({ type: "hunt-poll" }), new Promise((ok) => setTimeout(() => ok({ error: "no answer in 90s — reload the pinned old.reddit.com tab" }), 90000))]);
    if (r && r.error) $("sPoll").textContent = "last check failed: " + r.error;
    else if (r && r.report) $("scan").textContent = "This check: " + r.report;
  } finally { $("now").textContent = "Scan now"; $("now").disabled = false; scanTick(); refresh(); checkAhead(); }
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
  profile = { ...(config.profile || {}), autoWrite: $("cAuto").checked, dmGapMin: Number($("cGapMin").value) || 60, dmGapMax: Number($("cGapMax").value) || 180, dmCap: Number($("cDmCap").value) || 25, dmLinks: $("cLinks").checked, aiModel: $("cModel").value, aiBudgetCents: Math.max(0, Math.round((parseFloat($("cBudget").value) || 1) * 100)), aiPolish: $("cPolish").checked, fitStrict: $("cFit").value || "strict", name: $("cName").value.trim(), role: $("cRole").value.trim(), reddit: $("cReddit").value.trim().replace(/^\/?u\//, ""), whatsapp: $("cWa").value.trim(), telegram: $("cTg").value.trim(), linkedin: $("cLi").value.trim(), booking: $("cBook").value.trim(), portfolio: $("cPort").value.trim(), credit: $("cCredit").value.trim(), location: $("cLoc").value.trim(), apiKey: $("cKey").value.trim(), aiEngine: profile.aiEngine || "" };
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
  if (r && r.ok && !profile.aiEngine) { profile.aiEngine = "slots"; await saveSetup(true); for (const rb of document.querySelectorAll('input[name="engine"]')) rb.checked = rb.value === "slots"; aiErr = {}; render(); }
};
$("cPolish").onchange = () => saveSetup(true);
$("cAuto").onchange = () => { saveSetup(true); render(); };
$("cLinks").onchange = async () => { await saveSetup(true); for (const q of queue) delete q.ai; if (cur) { delete cur.ai; variant = 0; render(); } };
for (const id of ["cName", "cRole", "cReddit", "cWa", "cTg", "cLoc", "cLi", "cBook", "cPort", "cCredit", "cKey", "cSrv", "cSrvTok", "cBudget", "cGapMin", "cGapMax", "cDmCap"]) {
  $(id).addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSetup(false), 700); });
  $(id).addEventListener("blur", () => saveSetup(true));
}
$("showAdv").onclick = () => { $("adv").hidden = !$("adv").hidden; };

// ---- backup and restore ---------------------------------------------------
$("doBackup").onclick = async () => {
  const data = await send({ type: "hunt-export" });
  if (!data) { $("backupMsg").textContent = "could not read the database"; return; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `cofounder-hunt-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $("backupMsg").textContent = `saved ${data.counts.posts} posts, ${data.counts.contacted} people contacted, ${data.counts.threads} chat threads. Your API key is not in the file.`;
  $("backupMsg").style.color = "#7ee29a";
};
$("doRestore").onclick = () => $("restoreFile").click();
$("restoreFile").onchange = async () => {
  const f = $("restoreFile").files[0];
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (_) { $("backupMsg").textContent = "that file is not readable JSON"; $("backupMsg").style.color = "#ff8a65"; return; }
  const mode = confirm("Add anything missing and keep what is here?\n\nOK = merge (safe)\nCancel = replace what is here with the file") ? "merge" : "replace";
  const r = await send({ type: "hunt-import", data, mode });
  $("restoreFile").value = "";
  if (!r || !r.ok) { $("backupMsg").textContent = (r && r.error) || "restore failed"; $("backupMsg").style.color = "#ff8a65"; return; }
  $("backupMsg").textContent = `restored: ${r.counts.posts} posts, ${r.counts.contacted} contacted, ${r.counts.threads} threads`;
  $("backupMsg").style.color = "#7ee29a";
  refresh();
};
const AI_PRICES_UI = { "claude-opus-5": "Claude Opus 5 · best writing · about 2–4¢ a post", "claude-sonnet-5": "Claude Sonnet 5 · very good · about 1–1.5¢ a post (60% cheaper)" };
$("cModel").onchange = async () => { await saveSetup(true); aiErr = {}; for (const q of queue) delete q.ai; if (cur) { delete cur.ai; render(); } };

// ---- the deal: one dropdown, everything downstream follows it -------------
function dealOptions() {
  const d = profile.deal || DEAL_DEFAULT;
  $("cDeal").innerHTML = "";
  for (const m of dealOffers(d)) { const o = document.createElement("option"); o.value = m.key; o.textContent = (m.custom ? "★ " : "") + m.label; $("cDeal").appendChild(o); }
  const add = document.createElement("option"); add.value = "__add"; add.textContent = "＋ Add a new offer / service…"; $("cDeal").appendChild(add);
}
function dealLoad() {
  const d = profile.deal || DEAL_DEFAULT;
  dealOptions();
  $("cDeal").value = dealOffers(d).some((m) => m.key === d.mode) ? d.mode : "split";
  $("dealCard").innerHTML = $("cDeal").innerHTML; $("dealCard").value = $("cDeal").value;
  $("cUp").value = d.upfront; $("cShare").value = d.share; $("cExp").value = d.expenseShare; $("cNums").checked = !!d.numbersInDm;
  dealShow();
}
function dealRead() {
  return { ...(profile.deal || DEAL_DEFAULT), mode: $("cDeal").value, numbersInDm: $("cNums").checked, upfront: Number($("cUp").value) || DEAL_DEFAULT.upfront, share: Math.min(100, Number($("cShare").value) || DEAL_DEFAULT.share), expenseShare: Math.min(100, Number($("cExp").value) || DEAL_DEFAULT.expenseShare) };
}
function dealShow() {
  const sh = dealShape(dealRead());
  $("cUpWrap").hidden = !sh.hasUpfront;
  $("cShareWrap").hidden = sh.mode === "upfront" || sh.custom;
  $("cExpWrap").hidden = sh.mode !== "split" && sh.mode !== "upfront_share";
  $("cNumsWrap").hidden = !!sh.custom;
  $("offerEdit").hidden = !sh.custom; $("offerDel").hidden = !sh.custom;
  $("dealPreview").textContent = `In the first DM: "…we come in as your team and ${sh.shape}." Then: "${sh.question}" · In the inbox, when they ask: ${sh.terms}`;
}
let dealTimer = 0;
async function dealSave() {
  profile.deal = dealRead();
  dealShow();
  $("dealCard").innerHTML = $("cDeal").innerHTML; $("dealCard").value = $("cDeal").value;
  await send({ type: "inbox-terms", deal: profile.deal });
  // Everything already written used the old deal: drop it and write again for the card in front of you.
  for (const q of queue) delete q.ai;
  aiErr = {};
  if (cur) { delete cur.ai; variant = 0; render(); }
  $("setupMsg").textContent = "Deal saved ✓ — rewriting the replies";
  setTimeout(() => { $("setupMsg").textContent = "Saves itself as you type."; }, 1800);
}
$("cDeal").onchange = () => { if ($("cDeal").value === "__add") { offerForm(null); $("cDeal").value = (profile.deal || DEAL_DEFAULT).mode || "split"; return; } dealSave(); };
$("dealCard").onchange = () => {
  const v = $("dealCard").value;
  if (v === "__add") { $("setup").hidden = false; $("aiPanel").hidden = true; offerForm(null); $("dealCard").value = (profile.deal || DEAL_DEFAULT).mode || "split"; $("offerBox").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  $("cDeal").value = v; dealSave();
};
// ---- your own offers: name + the sentence that goes in the DM ------------
let offerEditing = null;
function offerForm(c) {
  offerEditing = c ? c.id : null;
  $("offerBox").hidden = false;
  $("oName").value = c ? c.name : ""; $("oDm").value = c ? c.dm : ""; $("oTerms").value = c ? (c.terms || "") : ""; $("oQ").value = c ? (c.question || "") : "";
  $("oName").focus();
}
$("offerEdit").onclick = () => { const d = profile.deal || {}; const c = (d.custom || []).find((x) => "custom:" + x.id === d.mode); if (c) offerForm(c); };
$("offerDel").onclick = async () => { const d = profile.deal || {}; profile.deal = { ...d, custom: (d.custom || []).filter((x) => "custom:" + x.id !== d.mode), mode: "split" }; dealLoad(); await dealSave(); };
$("offerCancel").onclick = () => { $("offerBox").hidden = true; offerEditing = null; };
$("offerSave").onclick = async () => {
  const name = $("oName").value.trim(), dm = $("oDm").value.trim();
  if (!name || !dm) { $("oMsg").textContent = "a name and the DM sentence are needed"; return; }
  const d = profile.deal || { ...DEAL_DEFAULT };
  const custom = [...(d.custom || [])];
  const id = offerEditing || ("c" + Date.now().toString(36));
  const item = { id, name, dm, terms: $("oTerms").value.trim(), question: $("oQ").value.trim() };
  const i = custom.findIndex((x) => x.id === id); if (i >= 0) custom[i] = item; else custom.push(item);
  profile.deal = { ...d, custom, mode: "custom:" + id };
  $("offerBox").hidden = true; offerEditing = null; $("oMsg").textContent = "";
  dealLoad(); await dealSave();
};
$("cNums").onchange = dealSave;
for (const id of ["cUp", "cShare", "cExp"]) {
  $(id).addEventListener("input", () => { dealShow(); clearTimeout(dealTimer); dealTimer = setTimeout(dealSave, 900); });
}

// ---- tables: click any counter to see exactly what is behind it ----------
let schedFilter = "all";
let schedTimer = 0;
const STATE_LOOK = {
  waiting: ["#8fb8ff", "still to come"],
  doomed: ["#98a0b3", "will not run"],
  opened: ["#e6c76b", "open in a tab, press send"],
  sent: ["#7ee29a", "sent"],
  cancelled: ["#ff8a65", "dropped"],
  gone: ["#98a0b3", "dropped"],
  done: ["#7ee29a", "already done"],
};
let schedGroup = true;      // one row per post, both steps side by side
async function drawSchedule() {
  const r = await send({ type: "hunt-schedule-list" });
  if (!r || $("table").hidden) return;
  const now = Date.now();
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const inMins = (t) => { const m = Math.round((t - now) / 60000); return m <= 0 ? "any moment" : m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h ${m % 60}m`; };
  const c = r.counts;
  $("tableTitle").textContent = `Schedule · ${c.waiting} waiting · ${c.opened} open · ${c.sent} sent`
    + (c.cancelled + c.gone ? ` · ${c.cancelled + c.gone} dropped` : "");
  const tabs = [["all", "Everything", r.rows.length], ["waiting", "Waiting", c.waiting], ["opened", "Open now", c.opened], ["sent", "Sent", c.sent], ["dropped", "Dropped", c.cancelled + c.gone]];
  $("schedTabs").innerHTML = tabs.map(([k, label, n]) => `<button class="ghost schedTab${schedFilter === k ? " on" : ""}" data-k="${k}">${label} ${n}</button>`).join("")
    + `<span style="width:10px"></span><button class="ghost" id="schedGroupBtn">${schedGroup ? "show every line" : "one row per post"}</button>`;
  for (const b of $("schedTabs").querySelectorAll(".schedTab")) b.onclick = () => { schedFilter = b.dataset.k; drawSchedule(); };
  $("schedGroupBtn").onclick = () => { schedGroup = !schedGroup; drawSchedule(); };
  $("schedTabs").hidden = false;
  $("schedGate").textContent = r.waiting
    ? `Next line opens ${inMins(r.nextAt)} at ${clock(r.nextAt)}.` + (r.gateWaitMs ? ` The pacing gap is holding DMs for another ${Math.ceil(r.gateWaitMs / 1000)}s${r.gateReason ? " · " + r.gateReason : ""}.` : "")
    : r.rows.length ? "Nothing left to open." : "";
  const matches = (x) => schedFilter === "all"
    || (schedFilter === "dropped" ? (x.state === "cancelled" || x.state === "gone" || x.state === "doomed") : x.state === schedFilter);
  const who = (x) => `${esc(x.author ? "u/" + x.author : "(unknown)")} <span style="color:#98a0b3">${x.sub ? "r/" + esc(x.sub) : ""}</span>`
    + (x.permalink ? ` <a href="${esc(x.permalink)}" target="_blank" rel="noopener" title="open the thread on Reddit">↗</a>` : "")
    + `<br><span style="color:#98a0b3">${esc(String(x.title).slice(0, 80))}</span>`;
  const btn = (x, label) => `<button class="ghost schedNow" data-id="${esc(x.id)}" data-kind="${x.kind}">${label}</button>`;

  if (schedGroup) {
    $("tableHead").innerHTML = "<tr><th>When</th><th>Post</th><th>Public reply</th><th>The DM</th><th>Now</th></tr>";
    const groups = [];
    const byId = new Map();
    for (const x of r.rows) {
      if (!byId.has(x.id)) { const g = { id: x.id, at: x.at, row: x, steps: {} }; byId.set(x.id, g); groups.push(g); }
      const g = byId.get(x.id);
      g.steps[x.kind] = x;
      g.at = Math.min(g.at, x.at);
    }
    const shown = groups.filter((g) => Object.values(g.steps).some(matches));
    const cell = (x) => {
      if (!x) return `<span style="color:#98a0b3">not scheduled</span>`;
      const [colour, word] = STATE_LOOK[x.state] || ["#98a0b3", x.state];
      const detail = x.state === "waiting" ? `${clock(x.at)} · ${inMins(x.at)}`
        : x.state === "opened" ? `opened ${ago(x.openedAt || x.at)}`
        : x.state === "sent" ? ago(x.sentAt || x.at)
        : x.reason || "";
      return `<b style="color:${colour}">${esc(word)}</b><br><span style="color:#98a0b3">${esc(detail)}</span>`;
    };
    $("tableRows").innerHTML = shown.map((g) => {
      const rep = g.steps.reply, dm = g.steps.dm;
      const acts = [rep && rep.state === "waiting" ? btn(rep, "reply now") : "", dm && dm.state === "waiting" ? btn(dm, "DM now") : "",
        (rep && rep.state === "opened") || (dm && dm.state === "opened") ? btn((rep && rep.state === "opened") ? rep : dm, "reopen") : ""].filter(Boolean).join(" ");
      const done = [rep, dm].every((x) => !x || x.state === "sent");
      return `<tr${done ? ' class="done"' : ""}><td>${esc(clock(g.at))}</td><td>${who(g.row)}</td><td>${cell(rep)}</td><td>${cell(dm)}</td><td>${acts}</td></tr>`;
    }).join("") || `<tr><td colspan="5" style="color:#98a0b3">${r.rows.length ? "Nothing in this group." : 'Nothing scheduled yet. Tick the boxes on the left of the queue rows, then use the bar that appears at the top of the list: set the minutes apart and press "Schedule these".'}</td></tr>`;
  } else {
    $("tableHead").innerHTML = "<tr><th>When</th><th>What</th><th>Post</th><th>State</th><th>Now</th></tr>";
    const shown = r.rows.filter(matches);
    $("tableRows").innerHTML = shown.map((x) => {
      const [colour, word] = STATE_LOOK[x.state] || ["#98a0b3", x.state];
      const detail = x.state === "waiting" ? inMins(x.at)
        : x.state === "opened" ? `opened ${ago(x.openedAt || x.at)}`
        : x.state === "sent" ? ago(x.sentAt || x.at)
        : x.reason || "";
      const acts = x.state === "waiting" ? btn(x, "Open now") + `<button class="ghost unsched" data-id="${esc(x.id)}" data-kind="${x.kind}">remove</button>`
        : x.state === "opened" ? btn(x, "reopen") : "";
      return `<tr${x.state === "sent" ? ' class="done"' : ""}><td>${esc(clock(x.at))}</td>`
        + `<td>${x.kind === "reply" ? "public reply" : "the DM"}${x.written ? "" : ` <span class="foot" style="margin:0" title="Claude writes it in the seconds before the line opens">· not written yet</span>`}</td>`
        + `<td>${who(x)}</td>`
        + `<td style="color:${colour}"><b>${esc(word)}</b>${detail ? `<br><span style="color:#98a0b3">${esc(detail)}</span>` : ""}</td>`
        + `<td>${acts}</td></tr>`;
    }).join("") || `<tr><td colspan="5" style="color:#98a0b3">${r.rows.length ? "Nothing in this group." : "Nothing scheduled yet."}</td></tr>`;
  }
  for (const b of $("tableRows").querySelectorAll("button.unsched")) b.onclick = async () => { await send({ type: "hunt-schedule-clear", id: b.dataset.id, kind: b.dataset.kind }); drawSchedule(); refresh(false); };
  for (const b of $("tableRows").querySelectorAll("button.schedNow")) b.onclick = async () => {
    b.textContent = "opening…"; b.disabled = true;
    const out = await send({ type: "hunt-schedule-run", id: b.dataset.id, kind: b.dataset.kind });
    if (out && !out.ok) $("schedGate").textContent = "could not open it: " + (out.error || "unknown");
    drawSchedule(); refresh(false);
  };
  clearTimeout(schedTimer);
  schedTimer = setTimeout(() => { if (!$("table").hidden && $("tableHead").textContent.includes("When")) drawSchedule(); }, 15000);
}
// One list, in one order. A post you have finished stays exactly where it
// sorts, struck out and greyed, with the time it went and which halves went.
// Moving it to a section at the bottom hid the shape of the day: how many are
// done, and when they were done.
let doneToday = [];
function wireQueueRows() {
  for (const th of $("tableHead").querySelectorAll("th.colsort")) th.onclick = () => colClick(th.dataset.k);
  for (const cb of $("tableRows").querySelectorAll("input.rowpick")) {
    cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) picked.add(cb.dataset.id); else picked.delete(cb.dataset.id); paintBulk(); };
  }
  if ($("pickAll")) $("pickAll").onclick = () => {
    for (const cb of $("tableRows").querySelectorAll("input.rowpick")) { cb.checked = $("pickAll").checked; if (cb.checked) picked.add(cb.dataset.id); else picked.delete(cb.dataset.id); }
    paintBulk();
  };
  paintBulk();
  const openIt = (id) => {
    const i = queue.findIndex((x) => x.id === id);
    if (i >= 0) { queue = [queue[i], ...queue.filter((_, j) => j !== i)]; cur = queue[0]; variant = 0; }
    openRow = ""; $("table").hidden = true; $("main").hidden = false; render();
  };
  for (const b of $("tableRows").querySelectorAll("button.openfull")) b.onclick = () => openIt(b.dataset.id);
  for (const b of $("tableRows").querySelectorAll("button.rowskip")) b.onclick = async () => { await send({ type: "hunt-act", id: b.dataset.id, action: "skip" }); openRow = ""; queue = queue.filter((q) => q.id !== b.dataset.id); await refresh(false); showTable("queue"); };
  for (const b of $("tableRows").querySelectorAll("button.rowbad")) b.onclick = async () => { await send({ type: "hunt-act", id: b.dataset.id, action: "not_relevant" }); openRow = ""; queue = queue.filter((q) => q.id !== b.dataset.id); await refresh(false); showTable("queue"); };
  for (const tr of $("tableRows").querySelectorAll("tr.pick")) {
    tr.onclick = (e) => {
      if (e.target && (e.target.classList.contains("rowpick") || e.target.tagName === "BUTTON" || e.target.tagName === "A")) return;
      const id = tr.dataset.id;
      // first click opens a short reading of the post, a second opens it fully
      if (openRow !== id) { openRow = id; drawQueueRows(); return; }
      openIt(id);
    };
  }
}
function drawQueueRows() {
  const rows = [...queue.map((p) => ({ p, done: null })), ...doneToday.map((d) => ({ p: d, done: d }))];
  const key = colSort.key && COL_SORT[colSort.key] ? colSort.key : "";
  if (key) rows.sort((a, b) => COL_SORT[key](a.p, b.p) * colSort.dir);
  else rows.sort((a, b) => (b.p.created || b.p.firstSeen || b.p.at || 0) - (a.p.created || a.p.firstSeen || a.p.at || 0));
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const html = rows.map(({ p, done }) => {
    if (done) {
      const marks = [done.repliedAt ? "reply ✓" : "", done.dmAt ? "DM ✓" : ""].filter(Boolean).join(" · ");
      return `<tr class="struck"><td></td>`
        + `<td><b title="${esc(p.title || "")}">${esc(titleForRow(p.title))}</b><br><span>r/${esc(p.sub || "")} · ${esc(p.author || "")}</span></td>`
        + `<td class="mark">${esc(marks)}</td><td></td><td></td>`
        + `<td class="when" style="color:#98a0b3">${esc(clock(done.at))}</td><td></td></tr>`;
    }
    const s = huntSynopsis(p);
    const open = openRow === p.id;
    const half = p.repliedAt ? ` <span class="mark" style="color:#7ee29a;font-size:11px">reply ✓ — DM still to send</span>` : "";
    const row = `<tr class="pick" data-id="${p.id}"${open ? ' style="background:#1b1f27"' : ""}><td><input type="checkbox" class="rowpick" data-id="${p.id}"${picked.has(p.id) ? " checked" : ""}></td>`
      + `<td><b title="${esc(p.title)}">${esc(titleForRow(p.title))}</b>${half}<br>${badgeTag(p)} <span style="color:#98a0b3">r/${esc(p.sub)} · ${esc(p.author)}${p.kind ? " · " + esc(p.kind) : ""}${p.budget ? " · " + esc(p.budget) : ""}</span></td>`
      + `<td>${esc(s.who)}</td><td>${esc(s.wants)}</td><td>${esc(s.country || "—")}</td><td>${ago(p.created || p.firstSeen)}</td><td>${p.score}</td></tr>`;
    if (!open) return row;
    const bits = [["Who", s.who], ["Wants", s.wants], ["Where", s.country], ["Stage", s.stage], ["Money", s.money], ["Traction", s.traction || s.revenue], ["Time", s.commit], ["Equity", s.equity]].filter(([, v]) => v);
    const gist = String(p.body || "").replace(/\s+/g, " ").trim().slice(0, 320);
    return row + `<tr class="syn-row"><td></td><td colspan="6" style="padding:4px 10px 14px">
      <div style="color:#98a0b3;font-size:12px;margin-bottom:6px">${bits.map(([k, v]) => `<b style="color:#e8eaf0">${esc(k)}:</b> ${esc(v)}`).join(" &nbsp;·&nbsp; ")}</div>
      <div style="color:#c9cede">${esc(gist)}${p.body && p.body.length > 320 ? "…" : ""}</div>
      <div class="row" style="margin:8px 0 0">
        <button class="primary openfull" data-id="${p.id}">Open this one</button>
        <button class="ghost rowskip" data-id="${p.id}">Skip</button>
        <button class="ghost rowbad" data-id="${p.id}">Not relevant</button>
        <a href="https://www.reddit.com${esc(String(p.permalink || "").replace(/^https?:\/\/[^/]+/, ""))}" target="_blank" rel="noopener" class="foot" style="margin:0">read it on Reddit ↗</a>
      </div></td></tr>`;
  }).join("");
  $("tableRows").innerHTML = html || `<tr><td colspan="7" style="color:#98a0b3">Nobody waiting yet.</td></tr>`;
  const base = queue.length === allQueue.length ? `Queue (${queue.length})` : `Queue (${queue.length} of ${allQueue.length} — filtered)`;
  $("tableTitle").textContent = base + (doneToday.length ? ` · ${doneToday.length} done today` : "");
  wireQueueRows();
}
let tableKind = "";
let tableDrawing = false;
function showTable(kind) {
  tableKind = kind;
  $("table").hidden = false;
  if ($("skBar")) $("skBar").hidden = kind !== "skipped";
  if ($("schedTabs")) { $("schedTabs").hidden = kind !== "schedule"; $("schedGate").textContent = ""; }
  clearTimeout(schedTimer);
  $("main").hidden = true;
  $("setup").hidden = true;
  $("tableFind").value = "";
  if (kind === "schedule") {
    schedFilter = schedFilter || "all";
    $("tableTitle").textContent = "Schedule";
    $("tableNote").textContent = "Every line, and what became of it. Nothing is sent by the extension: a line opens the tab with the text already in it and you press Reddit's own button. Press Open now to jump the queue on any line that is still waiting.";
    $("tableHead").innerHTML = "<tr><th>When</th><th>What</th><th>Post</th><th>State</th><th>Now</th></tr>";
    $("tableRows").innerHTML = `<tr><td colspan="5" style="color:#98a0b3">reading…</td></tr>`;
    tableText = () => "";
    drawSchedule();
    return;
  }
  if (kind === "plan") {
    const r = lastPlan;
    $("tableTitle").textContent = r
      ? (r.preview ? `Simulation · the first ${r.rows.length} of ${r.totalDms} DMs and ${r.totalReplies} public comments` : `Simulation · ${r.dms} DMs, ${r.replies} public comments`)
      : "Simulation";
    $("tableNote").textContent = "Nothing here has happened. No message is written, nothing is sent and nobody is marked contacted. Press \u201cPut it on the schedule\u201d in the Campaign panel to make it real.";
    $("tableHead").innerHTML = "<tr><th>When</th><th>Who</th><th>Post</th><th>What goes out</th><th>Thread</th></tr>";
    if (!r) { $("tableRows").innerHTML = `<tr><td colspan="5" style="color:#98a0b3">Press Simulate 5 or Show the plan.</td></tr>`; return; }
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const rows = r.rows.map((x) => `<tr><td>${esc(clock(x.replyAt || x.dmAt))}</td>`
      + `<td>${esc(x.author ? "u/" + x.author : "")}<br><span style="color:#98a0b3">r/${esc(x.sub || "")}</span></td>`
      + `<td>${esc(String(x.title || "").slice(0, 70))}</td>`
      + `<td>${x.reply ? `<b style="color:#7ee29a">public comment</b> ${esc(clock(x.replyAt))}<br>` : ""}<b>the DM</b> ${esc(clock(x.dmAt))}</td>`
      + `<td style="color:#98a0b3">${x.comments} comment${x.comments === 1 ? "" : "s"} · ${x.ups} up${x.ups === 1 ? "" : "s"}${x.reply ? " · busiest of its group" : ""}</td></tr>`).join("");
    const left = r.skipped.length ? `<tr><td colspan="5" style="padding-top:14px"><b>Not included</b></td></tr>`
      + r.skipped.map((x) => `<tr><td></td><td>${esc(x.author ? "u/" + x.author : "")}</td><td>${esc(String(x.title || "").slice(0, 70))}</td><td colspan="2" style="color:#e6c76b">${esc(x.why)}</td></tr>`).join("") : "";
    const foot = `<tr><td colspan="5" style="padding-top:14px;color:#98a0b3">`
      + `${r.preview ? r.totalDms : r.dms} of ${r.inQueue} in the queue · about ${r.gapMin} minutes apart · `
      + (r.rows.length ? `first ${esc(clock(r.firstAt))}, last ${esc(clock(r.lastAt))} · ` : "")
      + `writing them costs about ${usd(r.costCents)} · ${r.capLeft} DMs left under today's cap`
      + (r.preview ? ` · showing the first ${r.rows.length}` : "")
      + `</td></tr>`;
    $("tableRows").innerHTML = (rows + left + foot) || `<tr><td colspan="5" style="color:#98a0b3">Nothing in the queue to plan.</td></tr>`;
    tableText = () => r.rows.map((x) => `${clock(x.replyAt || x.dmAt)} u/${x.author} ${x.reply ? "comment + DM" : "DM"} — ${x.title}`).join("\n");
    return;
  }
  if (kind === "rejects") {
    $("tableTitle").textContent = "Filtered out";
    $("tableNote").textContent = "Posts the scan read and decided were not co-founder asks, newest first, with the reason it gave. It is a guess and it is often wrong, so this is where you check it. Put any of them in the queue and it behaves like any other post. Held for seven days.";
    $("tableHead").innerHTML = "<tr><th>Post</th><th>Who</th><th>Why it was dropped</th><th>Age</th><th></th></tr>";
    $("tableRows").innerHTML = `<tr><td colspan="5" style="color:#98a0b3">reading…</td></tr>`;
    tableText = () => "";
    send({ type: "hunt-rejects" }).then((r) => {
      if (!r) return;
      $("tableTitle").textContent = `Filtered out · ${r.rows.length}`;
      $("tableRows").innerHTML = r.rows.map((x) => `<tr>`
        + `<td><a href="${esc(x.permalink || "#")}" target="_blank" rel="noopener">${esc(String(x.title || "(no title)").slice(0, 90))}</a>`
        + `<br><span style="color:#98a0b3">r/${esc(x.sub || "")}</span></td>`
        + `<td>${esc(x.author ? "u/" + x.author : "")}</td>`
        + `<td style="color:#e6c76b">${esc(x.why || "not a co-founder ask")}</td>`
        + `<td style="color:#98a0b3">${esc(ago(x.created || x.at || 0))}</td>`
        + `<td><button class="ghost rescue" data-id="${esc(x.id)}">Put in the queue</button></td></tr>`).join("")
        || `<tr><td colspan="5" style="color:#98a0b3">Nothing has been filtered out in the last seven days.</td></tr>`;
      for (const b of $("tableRows").querySelectorAll("button.rescue")) b.onclick = async () => {
        b.disabled = true; b.textContent = "adding…";
        await send({ type: "hunt-rescue", id: b.dataset.id });
        showTable("rejects"); refresh(false);
      };
    });
    return;
  }
  if (kind === "skipped") {
    $("tableTitle").textContent = "Put back";
    $("tableNote").textContent = "Everything you set aside: skipped, marked not relevant, or parked until tomorrow. Nothing here was deleted. Tick the ones you want and press Put back in the queue.";
    $("tableHead").innerHTML = `<tr><th style="width:28px"><input type="checkbox" id="skAll"></th><th>Post</th><th>Who</th><th>Why it left</th><th>When</th></tr>`;
    $("tableRows").innerHTML = `<tr><td colspan="5" style="color:#98a0b3">reading…</td></tr>`;
    tableText = () => "";
    send({ type: "hunt-skipped" }).then((r) => {
      if (!r) return;
      const rows = r.rows.map((x) => `<tr><td><input type="checkbox" class="skPick" data-id="${esc(x.id)}"></td>`
        + `<td><a href="${esc(x.permalink || "#")}" target="_blank" rel="noopener">${esc(x.title || "(no title)")}</a></td>`
        + `<td>${esc(x.author ? "u/" + x.author : "")}${x.sub ? ` <span style="color:#98a0b3">r/${esc(x.sub)}</span>` : ""}</td>`
        + `<td style="color:${x.byAi ? "#e6c76b" : "#98a0b3"}">${esc(x.why)}</td>`
        + `<td style="color:#98a0b3">${x.at ? esc(ago(x.at)) : ""}</td></tr>`).join("");
      $("tableTitle").textContent = `Put back · ${r.rows.length} set aside`;
      $("tableRows").innerHTML = rows || `<tr><td colspan="5" style="color:#98a0b3">Nothing has been set aside.</td></tr>`;
      const picks = () => Array.from($("tableRows").querySelectorAll(".skPick:checked")).map((c) => c.dataset.id);
      const paint = () => { const n = picks().length; $("skBack").disabled = !n; $("skBack").textContent = n ? `Put ${n} back in the queue` : "Put back in the queue"; };
      if ($("skAll")) $("skAll").onclick = () => { for (const c of $("tableRows").querySelectorAll(".skPick")) c.checked = $("skAll").checked; paint(); };
      for (const c of $("tableRows").querySelectorAll(".skPick")) c.onclick = paint;
      $("skBar").hidden = !r.rows.length;
      $("skBack").onclick = async () => {
        const ids = picks();
        if (!ids.length) return;
        $("skBack").disabled = true; $("skBack").textContent = "putting back…";
        await send({ type: "hunt-bulk", ids, action: "undo" });
        showTable("skipped"); refresh(false);
      };
      paint();
    });
    return;
  }
  if (kind === "spend") {
    $("tableTitle").textContent = "AI spending";
    $("tableNote").textContent = "Every call your API key paid for today, newest first. Nothing here is charged twice: a reply written once is cached on the post.";
    $("tableHead").innerHTML = "<tr><th>Time</th><th>For</th><th>About</th><th>Model</th><th>Tokens in / out</th><th>Cost</th></tr>";
    $("tableRows").innerHTML = `<tr><td colspan="6" style="color:#98a0b3">reading…</td></tr>`;
    tableText = () => "";
    send({ type: "hunt-spend" }).then((r) => {
      if (!r) return;
      const when = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const sum = r.byKind.map((k) => `<tr><td colspan="2"><b>${esc(k.kind)}</b></td><td>${k.calls} call${k.calls === 1 ? "" : "s"}</td><td style="color:#98a0b3">${usd(k.cents / k.calls)} each</td><td style="color:#98a0b3">${k.in.toLocaleString()} / ${k.out.toLocaleString()}</td><td><b>${usd(k.cents)}</b></td></tr>`).join("");
      const rows = r.rows.map((x) => `<tr><td style="color:#98a0b3">${when(x.at)}</td><td>${esc(x.kind || "")}</td><td>${esc(x.who ? "u/" + x.who + " · " : "")}${esc(x.what || "")}</td><td style="color:#98a0b3">${esc((x.model || "").replace("claude-", ""))}</td><td style="color:#98a0b3">${(x.in || 0).toLocaleString()} / ${(x.out || 0).toLocaleString()}</td><td>${usd(x.cents)}</td></tr>`).join("");
      const past = r.days.length ? `<tr><td colspan="6" style="color:#98a0b3;padding-top:14px">Earlier days</td></tr>` + r.days.map((d) => `<tr><td style="color:#98a0b3">${esc(d.day)}</td><td colspan="4"></td><td>${usd(d.cents)}</td></tr>`).join("") : "";
      $("tableTitle").textContent = `AI spending today: ${usd(r.cents)} of ${usd(r.budget)} · ${r.calls} call${r.calls === 1 ? "" : "s"}${r.calls ? ` · ${usd(r.cents / r.calls)} a call` : ""}`;
      $("tableRows").innerHTML = (sum ? `<tr><td colspan="6" style="color:#98a0b3">Where it went</td></tr>` + sum + `<tr><td colspan="6" style="color:#98a0b3;padding-top:14px">Every call</td></tr>` : "") + (rows || `<tr><td colspan="6" style="color:#98a0b3">Nothing spent today.</td></tr>`) + past;
      tableText = () => r.rows.map((x) => `${when(x.at)}\t${x.kind}\t${x.who}\t${x.what}\t${x.model}\t${x.in}/${x.out}\t${usd(x.cents)}`).join("\n");
    });
    return;
  }
  $("bulkBar").hidden = kind !== "queue" || picked.size === 0;
  if (kind === "queue") {
    $("tableTitle").textContent = queue.length === allQueue.length ? `Queue (${queue.length})` : `Queue (${queue.length} of ${allQueue.length} — filtered)`;
    $("tableNote").textContent = "Everyone waiting, in the order and filter set above. Click a row for a quick read, click again to work on it.";
    $("tableHead").innerHTML = `<tr><th style="width:28px"><input type="checkbox" id="pickAll" title="select everything shown"></th>`
      + colHead("post", "Post") + colHead("who", "Who") + colHead("wants", "Wants") + colHead("country", "Country") + colHead("age", "Age") + colHead("fit", "Fit") + `</tr>`;
    tableText = () => queue.map((p) => { const s = huntSynopsis(p); return `${p.title}  [r/${p.sub} · ${p.role} · ${s.who} · ${s.country || "?"} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments]`; }).join("\n");
    // today's finished posts come from the worker, then the list is drawn once
    send({ type: "hunt-done" }).then((r) => {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      // a post replied to but not yet DM'd is still waiting above, so it is not
      // also drawn as finished: that is the duplicate row all over again
      const waiting = new Set(queue.map((x) => x.id));
      doneToday = ((r && r.rows) || []).filter((d) => d.at >= midnight.getTime()).filter((d) => !waiting.has(d.id));
      if (!$("table").hidden && tableKind === "queue") drawQueueRows();
    });
    drawQueueRows();
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
$("sSpendWrap").onclick = () => showTable("spend");
$("schedChip").onclick = () => showTable("schedule");

// ---- selecting rows, then skipping or scheduling them ----------------------
function paintBulk() {
  const n = picked.size;
  $("bulkBar").hidden = n === 0;
  $("bulkCount").textContent = `${n} selected`;
}
async function bulk(action) {
  const ids = [...picked];
  if (!ids.length) return;
  const r = await send({ type: "hunt-bulk", ids, action });
  picked.clear();
  queue = queue.filter((q) => !ids.includes(q.id));
  if (cur && ids.includes(cur.id)) { cur = queue[0] || null; variant = 0; }
  await refresh(false);
  showTable("queue");
  $("sPoll").textContent = `${(r && r.n) || 0} posts ${action === "skip" ? "skipped" : action === "later" ? "put off until tomorrow" : "marked not relevant"}`;
}
$("bulkSkip").onclick = () => bulk("skip");
$("bulkBad").onclick = () => bulk("not_relevant");
$("bulkLater").onclick = () => bulk("later");
$("bulkNone").onclick = () => { picked.clear(); showTable("queue"); };
$("bulkSched").onclick = async () => {
  const ids = [...picked];
  if (!ids.length) return;
  const gapMin = Math.max(1, Number($("bulkGap").value) || 5);
  const r = await send({ type: "hunt-schedule", ids, gapMin, dmAfterSec: 60 });
  picked.clear();
  await refresh(false);
  showTable("schedule");
  $("sPoll").textContent = `${(r && r.added) || 0} posts scheduled, one every ${gapMin} minutes`;
};
$("backupWarn").onclick = () => { $("setup").hidden = false; $("aiPanel").hidden = true; $("doBackup").scrollIntoView({ behavior: "smooth", block: "center" }); };
$("undoBulk").onclick = async () => {
  const r0 = await send({ type: "hunt-queue", limit: 1 });
  const lb = r0 && r0.lastBulk;
  if (!lb || !lb.ids || !lb.ids.length) { $("undoBulk").hidden = true; return; }
  $("undoBulk").textContent = "putting them back…"; $("undoBulk").disabled = true;
  const r = await send({ type: "hunt-bulk", ids: lb.ids, action: "undo" });
  $("undoBulk").disabled = false;
  $("sPoll").textContent = `put ${(r && r.n) || 0} back in the queue`;
  await refresh(false);
};
$("cFit").innerHTML = FIT_MODES.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
$("cFit").onchange = () => saveSetup(true);
// the two content scripts read these straight from storage, not from the profile
$("cAutoSend").onchange = () => chrome.storage.local.set({ autoSend: $("cAutoSend").checked });
$("cSendSecs").oninput = () => chrome.storage.local.set({ autoSendSecs: Math.max(3, Math.min(60, Number($("cSendSecs").value) || 10)) });
chrome.storage.local.get(["autoSend", "autoSendSecs"]).then((x) => {
  $("cAutoSend").checked = x.autoSend !== false;
  $("cSendSecs").value = x.autoSendSecs || 10;
});
// ---- the campaign: a day of first contact, paced --------------------------
let lastPlan = null;
function campOpts() {
  return {
    dms: Math.max(1, Math.min(60, Number($("kDms").value) || 15)),
    ratio: Math.max(1, Math.min(10, Number($("kRatio").value) || 3)),
    fromHour: Math.max(0, Math.min(23, Number($("kFrom").value) || 9)),
    toHour: Math.max(1, Math.min(23, Number($("kTo").value) || 21)),
  };
}
function campSave() { send({ type: "hunt-campaign-set", campaign: campOpts() }); }
for (const id of ["kDms", "kRatio", "kFrom", "kTo"]) $(id).oninput = campSave;
// ---- the campaign's own screen ------------------------------------------
// It has its own URL inside the extension (hunt.html#campaign) so it can be
// opened straight to, and it shows the run: no thread table, no cards.
let runTimer = 0;
function runShow(on) {
  $("runView").hidden = !on;
  if (on) {
    $("wrap").hidden = true; $("table").hidden = true; $("setup").hidden = true;
    $("aiPanel").hidden = true; $("campaignPanel").hidden = true; $("empty").hidden = true;
    if (location.hash !== "#campaign") location.hash = "#campaign";
    drawRun();
  } else {
    clearTimeout(runTimer);
    if (location.hash === "#campaign") history.replaceState(null, "", location.pathname);
  }
}
const clockOf = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
async function drawRun() {
  const r = await send({ type: "hunt-campaign-status" });
  if (!r || $("runView").hidden) return;
  const c = r.running;
  if (!c) {
    $("runTitle").textContent = "No campaign yet";
    $("runState").textContent = ""; $("runWhen").textContent = "";
    $("runNext").textContent = "Nothing is running. Set the numbers below and put a day on the schedule.";
    $("runBar").style.width = "0"; $("runBarNote").textContent = "";
    $("runPlan").innerHTML = ""; $("runFeed").textContent = "";
    for (const id of ["runPause", "runResume", "runStop", "runOpenNow"]) $(id).hidden = true;
    $("runNew").hidden = false;
    return;
  }
  const doneDms = c.dmsSent, target = c.plannedDms;
  const pct = target ? Math.round(100 * doneDms / target) : 0;
  const live = c.state === "running";
  $("runTitle").textContent = `Campaign · ${new Date(c.startedAt).toLocaleDateString([], { day: "numeric", month: "short" })}`;
  $("runState").textContent = c.state === "running" ? (c.nextAt ? "running" : "finishing") : c.state;
  $("runState").style.color = c.state === "running" ? "#7ee29a" : c.state === "paused" ? "#e6c76b" : "#98a0b3";
  $("runWhen").textContent = `started ${clockOf(c.startedAt)}${c.doneAt ? ` · ended ${clockOf(c.doneAt)}` : ""}`;
  $("runNext").innerHTML = c.state === "paused"
    ? `<span style="color:#e6c76b">Paused.</span> Nothing opens until you press Resume.`
    : c.dmsOpen
      ? `<span style="color:#e6c76b">A tab is open now</span> for u/${esc((c.openNow[0] || {}).author || "")} — press send there, or it goes by itself after the countdown.`
      : c.next
        ? (() => { const m = Math.round((c.next.at - Date.now()) / 60000);
            return `Next: <b>${c.next.kind === "reply" ? "public comment" : "the DM"}</b> to <b>u/${esc(c.next.author)}</b> at <b>${clockOf(c.next.at)}</b>, ${m <= 0 ? "any moment now" : m === 1 ? "in a minute" : m < 60 ? `in ${m} minutes` : `in ${Math.floor(m / 60)}h ${m % 60}m`}.`; })()
        : `Nothing left to open.`;
  $("runBar").style.width = Math.min(100, pct) + "%";
  $("runBar").style.background = c.state === "paused" ? "#e6c76b" : "var(--or)";
  $("runBarNote").textContent = `${doneDms} of ${target} DMs sent · ${c.repliesSent} of ${c.plannedReplies} public comments`
    + (c.dmsWaiting ? ` · ${c.dmsWaiting} still to come` : "")
    + (c.dmsDropped + c.repliesDropped ? ` · ${c.dmsDropped + c.repliesDropped} dropped` : "");
  $("runPlan").innerHTML = [
    ["People", c.people],
    ["DMs today", `${c.plannedDms} · one public comment per ${c.settings.ratio}`],
    ["Hours", `${c.settings.fromHour}:00 to ${c.settings.toHour}:00`],
    ["Spacing", `about ${c.gapMin} minutes apart`],
    ["First", clockOf(c.firstAt)],
    ["Last", clockOf(c.lastAt)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(String(v))}</dd>`).join("");
  const feed = [
    ...c.recent.map((x) => `<div><span style="color:#7ee29a">sent</span> ${x.kind === "reply" ? "a public comment" : "the DM"} to u/${esc(x.author)} · ${esc(clockOf(x.at))}</div>`),
    ...c.droppedList.map((x) => `<div><span style="color:#e6c76b">dropped</span> u/${esc(x.author)} · ${esc(x.why)}</div>`),
  ];
  $("runFeed").innerHTML = feed.join("") || "Nothing has gone out yet.";
  $("runPause").hidden = !live;
  $("runResume").hidden = c.state !== "paused";
  $("runStop").hidden = !(c.state === "running" || c.state === "paused");
  $("runOpenNow").hidden = !(live && c.next);
  $("runNew").hidden = (c.state === "running" || c.state === "paused");
  clearTimeout(runTimer);
  runTimer = setTimeout(drawRun, 10000);
}
async function runControl(what) {
  $("runMsg").textContent = "…";
  const r = await send({ type: "hunt-campaign-control", what });
  $("runMsg").textContent = r && r.ok ? "" : "could not do that: " + ((r && r.error) || "no answer");
  drawRun(); refresh(false);
}
$("runPause").onclick = () => runControl("pause");
$("runResume").onclick = () => runControl("resume");
$("runStop").onclick = () => { if (confirm("Stop the campaign?\n\nEverything still to come is taken off the schedule. What has already gone out stays sent.")) runControl("stop"); };
$("runNew").onclick = () => { runShow(false); $("campaignPanel").hidden = false; $("campaignPanel").scrollIntoView({ behavior: "smooth", block: "center" }); };
$("runOpenNow").onclick = async () => {
  const r = await send({ type: "hunt-campaign-status" });
  const n = r && r.running && r.running.next;
  if (!n) return;
  const row = (await send({ type: "hunt-schedule-list" })).rows.find((x) => x.state === "waiting");
  if (!row) return;
  $("runOpenNow").disabled = true; $("runOpenNow").textContent = "opening…";
  await send({ type: "hunt-schedule-run", id: row.id, kind: row.kind });
  $("runOpenNow").disabled = false; $("runOpenNow").textContent = "Open the next one now";
  drawRun();
};
$("openCampaign").onclick = () => runShow($("runView").hidden);
// the button says what the campaign is doing, so it is never hidden state
async function campChip() {
  const r = await send({ type: "hunt-campaign-status" });
  const c = r && r.running;
  if (!c || c.state === "stopped" || c.state === "done") { $("openCampaign").textContent = "Campaign"; $("openCampaign").style.color = ""; return; }
  $("openCampaign").textContent = c.state === "paused"
    ? `Campaign · paused ${c.dmsSent}/${c.plannedDms}`
    : `Campaign · ${c.dmsSent}/${c.plannedDms}${c.nextAt ? " · next " + clockOf(c.nextAt) : ""}`;
  $("openCampaign").style.color = c.state === "paused" ? "#e6c76b" : "#7ee29a";
}
window.addEventListener("hashchange", () => { if (location.hash === "#campaign") runShow(true); });
send({ type: "hunt-campaign-get" }).then((c) => {
  if (!c) return;
  $("kDms").value = c.dms; $("kRatio").value = c.ratio; $("kFrom").value = c.fromHour; $("kTo").value = c.toHour;
});
async function showPlan(n) {
  $("planMsg").textContent = "working it out…"; $("planMsg").style.color = "";
  // a simulation plans the real day and shows the first few, so the rhythm you
  // are looking at is the rhythm you would get, not five spread over 12 hours
  const r = await send({ type: "hunt-campaign-plan", opts: campOpts() });
  if (!r || !r.ok) { $("planMsg").textContent = "could not plan it: " + ((r && r.error) || "no answer"); $("planMsg").style.color = "#ff8a65"; return; }
  lastPlan = n ? { ...r, rows: r.rows.slice(0, n), preview: n, totalDms: r.dms, totalReplies: r.replies } : r;
  $("planMsg").textContent = r.rows.length
    ? (n ? `first ${Math.min(n, r.dms)} of ` : "") + `${r.dms} DMs, ${r.replies} public ${r.replies === 1 ? "comment" : "comments"}, about ${r.gapMin} minutes apart · nothing sent, nothing marked`
    : "nothing in the queue to plan";
  $("planMsg").style.color = r.rows.length ? "#7ee29a" : "#e6c76b";
  showTable("plan");
}
$("planSim").onclick = () => showPlan(5);
$("planDay").onclick = () => showPlan(0);
$("planGo").onclick = async () => {
  const o = campOpts();
  if (!confirm(`Put ${o.dms} DMs and about ${Math.ceil(o.dms / o.ratio)} public comments on today's schedule, between ${o.fromHour}:00 and ${o.toHour}:00?\n\nEach one opens its tab at its time. Sending still runs the countdown you can stop.`)) return;
  $("planGo").disabled = true; $("planGo").textContent = "scheduling…";
  const r = await send({ type: "hunt-campaign-start", opts: o });
  $("planGo").disabled = false; $("planGo").textContent = "Put it on the schedule";
  if (!r || !r.ok) { $("planMsg").textContent = "could not schedule it: " + ((r && r.error) || "no answer"); $("planMsg").style.color = "#ff8a65"; return; }
  $("planMsg").textContent = `on the schedule: ${r.dms} DMs and ${r.replies} public comments, first at ${new Date(r.firstAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, last at ${new Date(r.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("planMsg").style.color = "#7ee29a";
  await refresh(false);
  runShow(true);                       // straight to the campaign, not to a table of rows
};
let dropped = null;
$("dropHide").onclick = () => { $("drop").hidden = true; dropped = null; };
$("dropBack").onclick = async () => {
  if (!dropped) return;
  $("dropBack").disabled = true;
  await send({ type: "hunt-act", id: dropped.id, action: "undo" });
  const back = dropped.id;
  $("drop").hidden = true; dropped = null; $("dropBack").disabled = false;
  await refresh(false);
  const p = queue.find((q) => q.id === back);
  if (p) { cur = p; variant = 0; render(); aiWrite(true); }
};
$("dropLoose").onclick = async () => {
  profile.fitStrict = "loose";
  $("cFit").value = "loose";
  await saveSetup(true);
  $("dropWhy").textContent = " Changed: from now on only job ads, people offering themselves and students are dropped.";
  $("dropBack").hidden = false;
  $("dropLoose").hidden = true;
};
$("sSkippedBtn").onclick = () => showTable("skipped");
$("sRejectBtn").onclick = () => showTable("rejects");
// ---- one list, three kinds --------------------------------------------
// Every lead is in the same queue with a badge saying what it is. The chips
// filter to one kind when you want to work only that kind; nothing is hidden.
let badgeFilter = "";
try { badgeFilter = localStorage.getItem("huntBadge") || ""; } catch (_) { /* fine */ }
let badgeCounts = {};
function paintBadges() {
  const tabs = [["", "All", Object.values(badgeCounts).reduce((a, b) => a + b, 0)]]
    .concat(BADGES.map((b) => [b.key, b.label, badgeCounts[b.key] || 0]));
  $("badgePick").innerHTML = tabs.map(([k, label, n]) => {
    const on = badgeFilter === k;
    const col = k ? badgeDef(k).colour : "var(--or)";
    return `<button data-b="${k}" class="${on ? "on" : ""}" style="${on ? `background:${col};border-color:${col}` : `color:${k ? col : "var(--dim)"}`}" title="${k ? esc(badgeDef(k).note) : "everything waiting"}">${label} ${n}</button>`;
  }).join("");
  for (const b of $("badgePick").querySelectorAll("button")) b.onclick = () => {
    badgeFilter = b.dataset.b;
    try { localStorage.setItem("huntBadge", badgeFilter); } catch (_) { /* fine */ }
    queue = applyView(allQueue);
    cur = queue[0] || null; variant = 0;
    paintBadges(); showTable("queue"); render();
  };
}
async function doReset(mode) {
  const all = mode === "all";
  const msg = all
    ? "Erase EVERYTHING: every post, and the list of people you have already contacted.\n\nWithout that list the same person can get a second DM. Only do this on a fresh Reddit account.\n\nContinue?"
    : "Clear the queue and start again?\n\nEvery post held here is thrown away and the next check brings the whole window back in, nothing skipped. Who you have contacted is kept, so nobody gets a second DM.";
  if (!confirm(msg)) return;
  $("resetMsg").textContent = "clearing…"; $("resetMsg").style.color = "";
  const r = await send({ type: "hunt-reset", mode: all ? "all" : "queue" });
  if (!r || !r.ok) { $("resetMsg").textContent = "could not clear: " + ((r && r.error) || "no answer"); $("resetMsg").style.color = "#ff8a65"; return; }
  $("resetMsg").textContent = `cleared ${r.before.posts} posts${r.keptContacted ? `, kept ${r.keptContacted} contacted` : ""} — checking every subreddit now…`;
  cur = null; queue = []; allQueue = []; picked.clear(); openRow = "";
  await refresh(false);
  const poll = await send({ type: "hunt-poll" });
  $("resetMsg").textContent = poll && poll.report ? "done: " + poll.report : poll && poll.error ? "cleared, but the check failed: " + poll.error : "done";
  $("resetMsg").style.color = "#7ee29a";
  await refresh(false);
  showTable("queue");
}
$("doReset").onclick = () => doReset("queue");
$("doResetAll").onclick = () => doReset("all");
$("undoReset").onclick = async () => {
  $("undoReset").textContent = "putting it back…"; $("undoReset").disabled = true;
  const r = await send({ type: "hunt-reset-undo" });
  $("undoReset").disabled = false;
  $("sPoll").textContent = r && r.ok ? `put back ${r.posts} posts and ${r.contacted} contacted` : "nothing to undo";
  await refresh(false);
  showTable("queue");
};
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
function updHot(on, why) {
  const b = $("updNow");
  b.classList.toggle("updhot", !!on);
  b.title = on ? why : "check for a new version";
}
async function showVersion() {
  const v = await send({ type: "version-state" });
  if (!v) return;
  const el = $("ver");
  el.className = "stat";
  // red and blinking only when there is a newer version to move to
  updHot(v.diskAhead || v.remoteAhead,
    v.diskAhead ? `v${v.onDisk} is in the folder and ready — click to reload` : `v${v.remote} is out and you are on v${v.onDisk}`);
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
  $("cModel").value = AI_PRICES_UI[profile.aiModel] ? profile.aiModel : "claude-sonnet-5";
  $("cBudget").value = ((Number(profile.aiBudgetCents) > 0 ? profile.aiBudgetCents : 100) / 100).toFixed(2); $("cPolish").checked = profile.aiPolish !== false;
  $("cLinks").checked = !!profile.dmLinks;
  $("cAuto").checked = !!profile.autoWrite;
  $("cFit").value = FIT_MODES.some((m) => m.key === profile.fitStrict) ? profile.fitStrict : "strict";
  $("cGapMin").value = profile.dmGapMin || 60; $("cGapMax").value = profile.dmGapMax || 180; $("cDmCap").value = profile.dmCap || 25;
  $("cName").value = profile.name || ""; $("cRole").value = profile.role || "";
  $("cReddit").value = profile.reddit || ""; $("cWa").value = profile.whatsapp || ""; $("cTg").value = profile.telegram || "";
  $("cKey").value = profile.apiKey || "";
  $("cLi").value = profile.linkedin || ""; $("cBook").value = profile.booking || ""; $("cPort").value = profile.portfolio || ""; $("cCredit").value = profile.credit || ""; $("cLoc").value = profile.location || "";
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
  if (location.hash === "#campaign") runShow(true);   // its own URL, opened straight to
  else showTable("queue");                  // the list first, the card when you pick one
  setInterval(() => { refresh(true); checkAhead(); }, 20000);
  setInterval(showVersion, 15000);
})();
