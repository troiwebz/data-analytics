// board.js — the Growth Board's screen.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (_) { res(null); } });
const say = (t, c) => { const e = $("#say"); e.textContent = t || ""; e.style.color = c || "var(--dim)"; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (t) => { if (!t) return "—"; const d = new Date(t), n = new Date(); const same = d.toDateString() === n.toDateString(); return same ? "today " + d.toTimeString().slice(0, 5) : d.toDateString().slice(0, 10); };
const ago = (t) => { if (!t) return "—"; const m = Math.floor((Date.now() - t) / 60000); if (m < 60) return m + "m"; if (m < 1440) return Math.floor(m / 60) + "h"; return Math.floor(m / 1440) + "d"; };

// ------------------------------------------------------------------- tabs
$$("nav button").forEach((b) => b.onclick = () => {
  $$("nav button").forEach((x) => x.classList.toggle("on", x === b));
  $$("main section").forEach((s) => s.classList.toggle("on", s.id === b.dataset.tab));
  location.hash = b.dataset.tab;
  if (b.dataset.tab === "answer") drawQueue();
  if (b.dataset.tab === "leads") drawLeads();
  if (b.dataset.tab === "targets") drawTargets();
  if (b.dataset.tab === "offers") drawOffers();
  if (b.dataset.tab === "results") drawResults();
  if (b.dataset.tab === "camp") drawCampaigns();
  if (b.dataset.tab === "mine") drawMine();
  if (b.dataset.tab === "boost") drawBoost();
});

// --------------------------------------------------------------- calendar
let BOARD = null;
async function drawPlan() {
  BOARD = await send({ type: "v2-board" });
  if (!BOARD || !BOARD.ok) { say("the extension's worker did not answer — reload the extension", "var(--warn)"); return; }
  const c = BOARD.counts;
  $("#planStat").innerHTML = [
    ["Planned", c.planned], ["Written", c.drafted], ["Posted", c.posted], ["Leads", c.leads], ["New leads", c.newLeads],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  const r8 = BOARD.ratio || { ok: true };
  $("#ratio").innerHTML = r8.ok
    ? `<div class="faint" style="margin-bottom:12px">${r8.posts} posts, ${r8.comments} public answers — ${esc(r8.why)}.</div>`
    : `<div class="note" style="border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.08);color:#f6d79b">${r8.posts} posts but only ${r8.comments} public answers. ${esc(r8.why)}.</div>`;
  const s = BOARD.settings || {};
  $("#days").value = s.days || 30; $("#kinds").value = s.kinds || "all";
  $("#perDay").value = String(s.perDay || 3);
  $("#magnetEvery").value = s.magnetEvery || 2; $("#cool").value = s.subCoolDays || 14;
  let lastDay = null;
  $("#planRows").innerHTML = (BOARD.rows || []).map((r) => {
    const newDay = r.day !== lastDay; lastDay = r.day;
    const cls = [newDay ? "dayline" : "", r.state === "posted" || r.state === "skipped" ? "done" : ""].filter(Boolean).join(" ");
    const stamp = `${newDay ? `<b>${when(r.at).replace(/ \d\d:\d\d$/, "")}</b><br>` : ""}<span class="faint">${new Date(r.at).toTimeString().slice(0, 5)}</span>`;
    if (r.skipped) return `<tr class="${cls}"><td>${stamp}</td><td colspan="5" class="faint">${esc(r.why)}</td></tr>`;
    const lane = `<span class="lane l-${r.lane === "talk" ? "talk" : r.lane}">${esc(r.laneName)}</span>`;
    const tag = r.magnet ? `<span class="tag t-magnet">offer</span>` : `<span class="tag t-value">gives</span>`;
    const wk = r.weekly ? ` <span class="tag t-weekly">weekly thread</span>` : "";
    const group = r.group === "ads" ? "already spending" : r.group === "owner" ? "business owner" : "general";
    const what = r.magnet ? esc(r.offerName) : esc(r.typeName);
    const title = r.draft ? `<div class="ttl">${esc(r.draft.title)}</div><div class="faint">${r.draft.words} words${r.draft.issues.length ? " · " + r.draft.issues.length + " to fix" : ""}</div>` : `<span class="faint">not written yet</span>`;
    const btns = r.state === "posted"
      ? `<a href="${esc(r.url || "#")}" target="_blank">open the post</a>`
      : `<button class="ghost" data-w="${r.n}">${r.draft ? "rewrite" : "write it"}</button>
         ${r.draft ? `<button class="ghost" data-v="${r.n}">read</button><button class="act" data-o="${r.n}">post it</button><button class="ghost" data-m="${r.n}">it is live</button>` : ""}
         <button class="ghost" data-s="${r.n}">skip</button>`;
    return `<tr class="${cls}">
      <td>${stamp}</td><td>${lane}<div class="faint">${group}</div></td>
      <td><b>r/${esc(r.sub)}</b>${wk}</td>
      <td>${tag}<div class="faint">${esc(r.typeName)}</div></td>
      <td>${what}${title}</td><td>${btns}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="faint">No calendar yet — press Build the calendar.</td></tr>`;
  $$("#planRows button[data-w]").forEach((b) => b.onclick = () => write(+b.dataset.w, !!BOARD.rows.find((r) => r.n === +b.dataset.w).draft));
  $$("#planRows button[data-v]").forEach((b) => b.onclick = () => view(+b.dataset.v));
  $$("#planRows button[data-o]").forEach((b) => b.onclick = () => open_(+b.dataset.o));
  $$("#planRows button[data-s]").forEach((b) => b.onclick = async () => { await send({ type: "v2-skip", n: +b.dataset.s }); drawPlan(); });
  // if the content script missed the moment the post went live — a full page
  // reload, a crosspost, posting from the phone — mark it here by hand so the
  // comments on it still turn into leads
  $$("#planRows button[data-m]").forEach((b) => b.onclick = async () => {
    const url = prompt("Paste the link to the post you put up:");
    if (!url) return;
    const r = await send({ type: "v2-posted", n: +b.dataset.m, url: url.trim() });
    say(r && r.ok ? (r.postId ? "logged — its comments become leads within the hour" : "logged, but that link had no post id in it, so comments cannot be read") : "could not log it", r && r.ok && r.postId ? "var(--go)" : "var(--warn)");
    drawPlan();
  });
}

$("#mkPlan").onclick = async () => {
  say("building…");
  const r = await send({ type: "v2-plan", opts: { days: +$("#days").value, perDay: +$("#perDay").value, kinds: $("#kinds").value, magnetEvery: +$("#magnetEvery").value, subCoolDays: +$("#cool").value } });
  if (!r || !r.ok) return say((r && r.error) || "could not build it", "var(--warn)");
  const g = r.groups || {};
  say(`${r.rows.length} posts across ${r.rooms} rooms — ${r.magnets} offers, ${r.values} that sell nothing · owners ${g.owner || 0}, spenders ${g.ads || 0}, general ${g.biz || 0} · needs about ${r.comments} public answers alongside`, "var(--go)");
  drawPlan();
};

async function write(n, force) {
  say("writing day " + n + "…");
  const r = await send({ type: "v2-draft", n, force: force ? true : false });
  if (!r || !r.ok) return say((r && r.error) || "could not write it", "var(--warn)");
  say(r.issues && r.issues.length ? "written, but " + r.issues.length + " thing(s) to fix" : "written — read it before it goes out", r.issues && r.issues.length ? "var(--warn)" : "var(--go)");
  await drawPlan();
  view(n);
}
async function view(n) {
  const b = await send({ type: "v2-board" });
  const row = (b.rows || []).find((r) => r.n === n);
  const full = await send({ type: "v2-draft", n });
  const d = full && full.draft;
  if (!d) return;
  $("#planDraft").innerHTML = `<div class="card">
    <h3>Day ${n} · r/${esc(row.sub)} · ${esc(row.typeName)}</h3>
    <div class="faint">${esc(d.why_this_sub || "")}${d.risk && d.risk !== "none" ? " · risk: " + esc(d.risk) : ""}</div>
    ${(d.issues || []).map((i) => `<div class="issue">⚠ ${esc(i)}</div>`).join("")}
    <div class="draft"><b>${esc(d.title)}</b>\n\n${esc(d.body)}</div>
    <div class="faint" style="margin-top:8px">First comment to leave under it a minute later:</div>
    <div class="draft">${esc(d.first_comment || "")}</div>
    <div class="bar" style="margin-top:12px">
      <button class="act" id="dOpen">Open Reddit and fill it</button>
      <button class="ghost" id="dAgain">Write a different one</button>
      <button class="ghost" id="dCopy">Copy the body</button>
      <span class="faint">${(d.cents || 0)}¢</span>
    </div></div>`;
  $("#dOpen").onclick = () => open_(n);
  $("#dAgain").onclick = () => write(n, true);
  $("#dCopy").onclick = async () => { await navigator.clipboard.writeText(d.body); say("copied", "var(--go)"); };
  $("#planDraft").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function open_(n) {
  const r = await send({ type: "v2-open", n });
  if (!r || !r.ok) return say((r && r.error) || "could not open it", "var(--warn)");
  say(r.weekly ? "that room takes offers only in its weekly thread — find it, then paste" : "Reddit is open and the form is being filled. You press Post.", "var(--go)");
}

// ------------------------------------------------------------ buyer queue
async function drawQueue() {
  const q = await send({ type: "v2-queue", limit: 80 });
  if (!q || !q.ok) return;
  $("#qStat").innerHTML = [["Already spending", q.tiers.spending], ["Owners", q.tiers.owner], ["Asking", q.tiers.asking], ["In the queue", q.total]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  $("#qRows").innerHTML = (q.rows || []).map((p) => `<tr>
    <td><span class="tag t-${esc(p.badge)}">${esc(p.badge)}</span>${p.amount ? `<div class="faint">${esc(p.amount)}</div>` : ""}</td>
    <td class="faint">r/${esc(p.sub)}</td>
    <td><a href="${esc(p.permalink)}" target="_blank">${esc(p.title)}</a><div class="faint">${esc(p.why)}</div></td>
    <td class="faint">${ago(p.created)}</td>
    <td><button class="ghost" data-a="${esc(p.id)}">write an answer</button><button class="ghost" data-d="${esc(p.id)}">drop</button></td></tr>`).join("")
    || `<tr><td colspan="5" class="faint">Nothing in the queue — press Scan for buyers. It reads every room and every money search.</td></tr>`;
  $$("#qRows button[data-a]").forEach((b) => b.onclick = () => answer(b.dataset.a));
  $$("#qRows button[data-d]").forEach((b) => b.onclick = async () => { await send({ type: "v2-queue-act", id: b.dataset.d, action: "drop" }); drawQueue(); });
  $("#scanLive").textContent = q.lastScan ? "last scan " + ago(q.lastScan) + " ago" : "";
}
async function answer(id) {
  say("writing an answer…");
  const r = await send({ type: "v2-answer", id, force: false });
  if (!r || !r.ok) return say((r && r.error) || "could not write it", "var(--warn)");
  const a = r.answer;
  const q = await send({ type: "v2-queue", limit: 200 });
  const p = (q.rows || []).find((x) => x.id === id) || {};
  $("#qDraft").innerHTML = `<div class="card">
    <h3>${esc(p.title || "")}</h3>
    <div class="faint">worth it: ${esc(a.worth_it)} — ${esc(a.worth_reason)}</div>
    ${(a.issues || []).map((i) => `<div class="issue">⚠ ${esc(i)}</div>`).join("")}
    <div class="draft">${esc(a.answer)}</div>
    <div class="faint" style="margin-top:6px">the specific that makes it credible: ${esc(a.specific || "")}</div>
    <div class="bar" style="margin-top:12px">
      <button class="act" id="aCopy">Copy and open the thread</button>
      <button class="ghost" id="aAgain">Write a different one</button>
      <button class="ghost" id="aDone">Mark as answered</button>
      <span class="faint">${a.cents || 0}¢</span>
    </div></div>`;
  say("");
  $("#aCopy").onclick = async () => { await navigator.clipboard.writeText(a.answer); window.open(p.permalink, "_blank"); };
  $("#aAgain").onclick = () => { send({ type: "v2-answer", id, force: true }).then(() => answer(id)); };
  $("#aDone").onclick = async () => { await send({ type: "v2-queue-act", id, action: "answered" }); $("#qDraft").innerHTML = ""; drawQueue(); };
  $("#qDraft").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#scan").onclick = async () => {
  $("#scan").disabled = true; $("#scanStop").style.display = "";
  send({ type: "v2-scan" }).then((r) => { $("#scan").disabled = false; $("#scanStop").style.display = "none"; if (r && r.ok) say(`read ${r.seen} posts across ${r.sources} sources, kept ${r.found}`, "var(--go)"); drawQueue(); });
  const tick = setInterval(async () => {
    const s = await send({ type: "v2-scan-state" });
    if (!s || !s.running) { clearInterval(tick); return; }
    $("#scanLive").textContent = `${esc(s.where)} · ${s.done} of ${s.total} · ${s.seen} posts read · ${s.found} kept`;
  }, 900);
};
$("#scanStop").onclick = () => { send({ type: "v2-scan-stop" }); say("stopping…"); };

// ----------------------------------------------------------------- leads
async function drawLeads() {
  const r = await send({ type: "v2-leads" });
  if (!r || !r.ok) return;
  $("#leadWhen").textContent = r.lastLeads ? "last checked " + ago(r.lastLeads) + " ago" : "not checked yet";
  $("#leadRows").innerHTML = (r.rows || []).map((l) => `<tr class="${l.state === "won" || l.state === "dropped" ? "done" : ""}">
    <td><span class="tag t-${l.tier >= 3 ? "spending" : l.tier === 2 ? "owner" : "asking"}">${esc(l.badge)}</span></td>
    <td><a href="https://www.reddit.com/user/${esc(l.author)}" target="_blank">u/${esc(l.author)}</a><div class="faint">${ago(l.at)} ago</div></td>
    <td class="ttl">${esc(String(l.body || "").slice(0, 260))}</td>
    <td class="faint">r/${esc(l.sub)}<div><a href="${esc(l.permalink)}" target="_blank">their comment</a></div></td>
    <td>${l.state === "new" ? `<button class="act" data-del="${esc(l.id)}">audit delivered</button>` : ""}
        <button class="ghost" data-rep="${esc(l.id)}">they replied</button>
        <button class="ghost" data-won="${esc(l.id)}">won</button>
        <button class="ghost" data-drp="${esc(l.id)}">drop</button></td></tr>`).join("")
    || `<tr><td colspan="5" class="faint">No leads yet. They appear here when someone comments on a post the board sent out.</td></tr>`;
  const wire = (attr, action) => $$(`#leadRows button[data-${attr}]`).forEach((b) => b.onclick = async () => { await send({ type: "v2-lead-act", id: b.dataset[attr], action }); drawLeads(); });
  wire("del", "delivered"); wire("rep", "replied"); wire("won", "won"); wire("drp", "drop");
}
$("#leadPoll").onclick = $("#leadPoll2").onclick = async () => {
  say("reading the comments on our posts…");
  const r = await send({ type: "v2-lead-poll" });
  say(r && r.ok ? `${r.added} new from ${r.posts} post(s)` : "could not read them", r && r.ok ? "var(--go)" : "var(--warn)");
  drawLeads(); drawPlan();
};

// ------------------------------------------------------------ offer studio
let OFF = null;
function offerCard(o, mode) {
  const issues = (o.issues || []).map((i) => `<div class="issue">⚠ ${esc(i)}</div>`).join("");
  const picked = OFF && (OFF.picked || []).includes(o.key);
  const head = mode === "made"
    ? `<button class="ghost" data-keep="${esc(o.key)}">keep this one</button>`
    : `<label class="f"><input type="checkbox" data-pick="${esc(o.key)}" ${picked || !(OFF.picked || []).length ? "checked" : ""}> use in the calendar</label>` +
      (o.made ? ` <button class="ghost" data-forget="${esc(o.key)}">remove</button>` : "");
  return `<div class="card">
    <h3>${esc(o.name)}</h3>
    <div class="faint">${esc(o.spots)} spots · ${esc(String(o.channel || "none").replace(/_/g, " "))}${o.angle ? " · " + esc(o.angle) : ""}${o.made ? " · yours" : ""}</div>
    ${issues}
    <ul class="tight">
      <li><b>Who:</b> ${esc(o.who)}</li>
      <li><b>They get:</b> ${esc(o.gift)}</li>
      <li><b>We ask for:</b> ${esc(o.ask)}</li>
      <li><b>Their risk:</b> ${esc(o.risk)}</li>
      ${o.why ? `<li><b>Why it lands:</b> ${esc(o.why)}</li>` : ""}
    </ul>
    <div class="bar" style="margin-top:10px">${head}</div></div>`;
}
async function drawOffers() {
  OFF = await send({ type: "v2-offers" });
  if (!OFF || !OFF.ok) return;
  if (OFF.brief && !$("#brief").value) $("#brief").value = OFF.brief;
  $("#madeGrid").innerHTML = (OFF.made || []).map((o) => offerCard(o, "made")).join("");
  const all = (OFF.shipped || []).concat(OFF.pool || []);
  $("#offerGrid").innerHTML = all.map((o) => offerCard(o, "pool")).join("");
  const n = (OFF.picked || []).length;
  $("#pickSay").textContent = n ? `${n} of ${all.length} ticked` : `all ${all.length} in use`;
  $$("#madeGrid button[data-keep]").forEach((b) => b.onclick = async () => {
    const r = await send({ type: "v2-offer-keep", key: b.dataset.keep });
    say(r && r.ok ? (r.already ? "already kept" : "kept — it is now in the calendar's pool") : "could not keep it", "var(--go)");
    drawOffers();
  });
  $$("#offerGrid button[data-forget]").forEach((b) => b.onclick = async () => { await send({ type: "v2-offer-forget", key: b.dataset.forget }); drawOffers(); });
  $$("#offerGrid input[data-pick]").forEach((cb) => cb.onchange = pickOffers);
}
async function pickOffers() {
  const boxes = $$("#offerGrid input[data-pick]");
  const on = boxes.filter((b) => b.checked).map((b) => b.dataset.pick);
  // everything ticked means "no preference", which keeps new offers in play
  await send({ type: "v2-offer-pick", keys: on.length === boxes.length ? [] : on });
  $("#pickSay").textContent = on.length === boxes.length ? `all ${boxes.length} in use` : `${on.length} of ${boxes.length} ticked`;
  if (!on.length) say("nothing ticked — the calendar will fall back to all of them", "var(--warn)");
}
$("#mkOffers").onclick = async () => {
  const brief = $("#brief").value.trim();
  if (!brief) return say("say what you do first", "var(--warn)");
  $("#mkOffers").disabled = true;
  $("#offerSay").textContent = "writing ten…";
  const r = await send({ type: "v2-offer-make", brief });
  $("#mkOffers").disabled = false;
  if (!r || !r.ok) { $("#offerSay").textContent = ""; return say((r && r.error) || "could not write them", "var(--warn)"); }
  $("#offerSay").textContent = `${r.made.length} written, ${r.clean} clean · ${r.cents}¢`;
  drawOffers();
};
$("#offAll").onclick = () => { $$("#offerGrid input[data-pick]").forEach((b) => b.checked = true); pickOffers(); };
$("#offNone").onclick = () => { $$("#offerGrid input[data-pick]").forEach((b) => b.checked = false); pickOffers(); };

// ----------------------------------------------------------------- rooms
let TGT = null;
function targetRows() {
  const checked = (TGT && TGT.checked) || {};
  const kind = $("#tKind").value, promoF = $("#tPromo").value, sort = $("#tSort").value, min = +$("#tMin").value || 0;
  let list = (TGT.targets || []).map((t) => ({ ...t, c: checked[t.sub] || null }));
  if (kind !== "all") list = list.filter((t) => t.kind === kind);
  if (promoF === "post") list = list.filter((t) => (V2.PROMO[t.promo] || {}).rank >= 1);
  if (promoF === "no") list = list.filter((t) => t.promo === "no");
  if (min) list = list.filter((t) => t.c && t.c.ok && (t.c.members || 0) >= min);
  const num = (t, f) => (t.c && t.c.ok ? (t.c[f] || 0) : -1);
  if (sort === "members") list.sort((a, b) => num(b, "members") - num(a, "members"));
  else if (sort === "online") list.sort((a, b) => num(b, "online") - num(a, "online"));
  else if (sort === "kind") list.sort((a, b) => a.kind.localeCompare(b.kind) || a.sub.localeCompare(b.sub));
  else list.sort((a, b) => a.sub.localeCompare(b.sub));
  return list;
}
function drawTargetTable() {
  const picked = new Set((TGT && TGT.picked) || []);
  const list = targetRows();
  $("#tRows").innerHTML = list.map((t) => {
    const c = t.c;
    const kind = t.kind === "ads" ? "already spending" : t.kind === "owner" ? "business owner" : "general business";
    const promo = (V2.PROMO[t.promo] || {}).name;
    const scraped = c && c.promoWhy ? `<div class="faint">from its own rules</div>` : "";
    const members = c ? (c.ok ? (c.members || 0).toLocaleString() : `<span style="color:var(--warn)">${esc(c.why)}</span>`) : `<span class="faint">—</span>`;
    const online = c && c.ok ? `<span style="color:${(c.online || 0) > 200 ? "var(--go)" : "var(--dim)"}">${(c.online || 0).toLocaleString()}</span>` : `<span class="faint">—</span>`;
    const rules = c && c.rules && c.rules.length
      ? `<div class="rules">rules: ${c.rules.slice(0, 6).map((r) => esc(r.name)).join(" · ")}${c.rules.length > 6 ? " · +" + (c.rules.length - 6) : ""}</div>` : "";
    const why = c && c.promoWhy ? `<div class="rules" style="color:var(--warn)">${esc(c.promoWhy)}</div>` : "";
    return `<tr>
      <td><input type="checkbox" data-sub="${esc(t.sub)}" ${picked.has(t.sub) || !picked.size ? "checked" : ""}></td>
      <td><a href="https://www.reddit.com/r/${esc(t.sub)}/" target="_blank">r/${esc(t.sub)}</a>${c && c.ok && c.over18 ? ' <span class="tag t-weekly">18+</span>' : ""}</td>
      <td class="faint">${kind}</td><td class="faint">${esc(promo)}${scraped}</td>
      <td>${members}</td><td>${online}</td>
      <td class="faint">${esc(c && c.title ? c.title : t.note)}${rules}${why}</td></tr>`;
  }).join("") || `<tr><td colspan="7" class="faint">Nothing matches those filters.</td></tr>`;
  $$("#tRows input[data-sub]").forEach((cb) => cb.onchange = pickRooms);
  const on = $$("#tRows input[data-sub]").filter((b) => b.checked).length;
  $("#tSay").textContent = `${list.length} shown · ${(TGT.picked || []).length || "all"} picked for the calendar`;
}
async function pickRooms() {
  // only the rows on screen are editable, so merge them into what was picked
  const shown = $$("#tRows input[data-sub]");
  const prev = new Set((TGT.picked || []).length ? TGT.picked : (TGT.targets || []).map((t) => t.sub));
  for (const b of shown) { if (b.checked) prev.add(b.dataset.sub); else prev.delete(b.dataset.sub); }
  const keys = Array.from(prev);
  TGT.picked = keys.length === (TGT.targets || []).length ? [] : keys;
  await send({ type: "v2-rooms", picked: TGT.picked });
  $("#tSay").textContent = `${shown.length} shown · ${TGT.picked.length || "all"} picked for the calendar`;
}
async function drawTargets() {
  TGT = await send({ type: "v2-targets" });
  if (!TGT || !TGT.ok) return;
  $("#checkLive").textContent = TGT.lastCheck ? "checked " + ago(TGT.lastCheck) + " ago" : "not checked against Reddit yet — press the button";
  drawTargetTable();
}
["tKind", "tPromo", "tSort", "tMin"].forEach((id) => { $("#" + id).onchange = drawTargetTable; $("#" + id).oninput = drawTargetTable; });
$("#tAll").onclick = () => { $$("#tRows input[data-sub]").forEach((b) => b.checked = true); pickRooms(); };
$("#tNone").onclick = () => { $$("#tRows input[data-sub]").forEach((b) => b.checked = false); pickRooms(); };
$("#checkT").onclick = async () => {
  $("#checkT").disabled = true; $("#checkStop").style.display = "";
  send({ type: "v2-check-targets" }).then((r) => {
    $("#checkT").disabled = false; $("#checkStop").style.display = "none";
    if (r && r.ok) say(`${r.checked} rooms confirmed, ${r.failed} could not be read, ${r.ruled} gave up their rules, ${r.moved} had their posting rule set from those rules`, "var(--go)");
    drawTargets();
  });
  const tick = setInterval(async () => {
    const st = await send({ type: "v2-check-state" });
    if (!st || !st.running) { clearInterval(tick); return; }
    $("#checkLive").textContent = `${esc(st.where)} · ${st.done} of ${st.total}`;
  }, 800);
};
$("#checkStop").onclick = () => { send({ type: "v2-check-stop" }); say("stopping…"); };

// --------------------------------------------------------------- results
function resTable(title, rows, note) {
  if (!rows.length) return "";
  const best = rows[0];
  return `<div class="card"><h3>${esc(title)}</h3><div class="faint">${esc(note)}</div>
    <table style="margin-top:8px"><thead><tr><th>${esc(title)}</th><th style="width:80px">Posts</th><th style="width:90px">Comments</th><th style="width:80px">Hot</th><th style="width:96px">Replied</th><th style="width:70px">Won</th><th style="width:110px">Per post</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.posts}</td><td>${r.leads}</td><td><b style="color:var(--go)">${r.hot}</b></td><td>${r.replied}</td><td>${r.won}</td><td>${r.per}</td></tr>`).join("")}</tbody></table>
    ${best.posts >= 3 ? `<div class="faint" style="margin-top:8px">Best so far: <b>${esc(best.name)}</b> at ${best.per} comments a post. Give it three posts before believing it.</div>` : `<div class="faint" style="margin-top:8px">Too early to call — nothing here has three posts behind it yet.</div>`}</div>`;
}
async function drawResults() {
  const b = BOARD && BOARD.results ? BOARD : await send({ type: "v2-board" });
  const r = (b && b.results) || { groups: [], shapes: [], offers: [] };
  const body = [
    resTable("Kind of room", r.groups, "Which audience answers. This is the one that decides where the next month goes."),
    resTable("Shape of post", r.shapes, "Which kind of post earns comments. Offer posts should win on leads, value posts on reach."),
    resTable("Offer", r.offers, "Which offer people actually raise a hand for."),
  ].filter(Boolean).join("");
  $("#resBody").innerHTML = body || `<div class="card"><h3>Nothing to measure yet</h3><div class="faint">Post a few days of the calendar, then pull the comments. Numbers appear here once posts have gone out.</div></div>`;
}

function adsPlanHtml() {
  const a = V2.ADS_PLAN;
  return `<div class="card"><h3>The plan behind all of this</h3><div class="faint">${esc(a.idea)}</div>
    <ul class="tight" style="margin-top:8px">${a.stages.map((st) => `<li><b>${esc(st.name)}</b> (${esc(st.spend)}) — ${esc(st.does)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Targeting</h3><ul class="tight">${a.targeting.map((t) => `<li><b>${esc(t.name)}:</b> ${esc(t.how)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Rules that decide whether this works</h3><ul class="tight">${a.rules.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    <div class="faint" style="margin-top:8px">Figures here are starting points. Reddit's own ad account shows the real minimums and costs on the day you open it.</div></div>`;
}

// ------------------------------------------------------------- campaigns
async function drawCampaigns() {
  const r = await send({ type: "v2-campaigns" });
  if (!r || !r.ok) return;
  const active = r.list.find((c) => c.key === r.active);
  $("#campActive").innerHTML = active
    ? `<div class="card" style="border-color:rgba(74,222,128,.4)"><h3>Running: ${esc(active.name)}</h3>
        <div class="faint">${esc(active.niche)}</div>
        <ul class="tight"><li>${active.shape.postable} of ${active.shape.rooms} rooms take a post — ${esc(active.shape.note)}</li>
        <li>calendar set to ${active.shape.perDay} post${active.shape.perDay === 1 ? "" : "s"} a day, same room no sooner than every ${active.shape.subCoolDays} days</li>
        ${active.members ? `<li>${active.members.toLocaleString()} members across its rooms, ${active.online.toLocaleString()} online right now</li>` : `<li class="faint">press Check against Reddit on the Targets tab to see how big these rooms are</li>`}</ul>
        <div class="bar" style="margin-top:10px"><button class="act" id="campPlan">Rebuild the calendar for this campaign</button><button class="ghost" id="campOff">Back to all rooms</button></div></div>`
    : `<div class="card"><h3>No campaign running</h3><div class="faint">The board is using all 191 rooms, which means nobody sees you twice. Pick one below.</div></div>`;
  $("#campGrid").innerHTML = r.list.map((c) => `<div class="card" style="${c.key === r.active ? "border-color:rgba(74,222,128,.4)" : ""}">
    <h3>${esc(c.name)}</h3>
    <div class="faint">${esc(c.niche)}</div>
    <div style="margin-top:6px">${esc(c.why)}</div>
    <ul class="tight" style="margin-top:8px">
      <li><b>${c.subs.length} rooms</b>, ${c.shape.postable} of them take a post · <span class="faint">${c.subs.slice(0, 6).map((x) => "r/" + x).join(", ")}${c.subs.length > 6 ? " +" + (c.subs.length - 6) : ""}</span></li>
      <li><b>${c.shape.mode === "post-led" ? "Post-led" : "Answer-led"}</b> — ${esc(c.shape.note)}</li>
      <li><b>Questions to own:</b> <span class="faint">${esc(c.queries.slice(0, 3).join(" · "))}…</span></li>
    </ul>
    <div class="bar" style="margin-top:10px">
      <button class="${c.key === r.active ? "ghost" : "act"}" data-camp="${esc(c.key)}">${c.key === r.active ? "running" : "run this one"}</button>
      <button class="ghost" data-q="${esc(c.key)}">its ${c.queries.length} questions</button>
    </div>
    <div id="q-${esc(c.key)}" hidden class="draft" style="font:12px/1.6 -apple-system,Segoe UI,sans-serif">${c.queries.map((q, i) => `${i + 1}. ${esc(q)}`).join("\n")}</div>
  </div>`).join("");
  $$("#campGrid button[data-camp]").forEach((b) => b.onclick = async () => {
    const res = await send({ type: "v2-campaign-set", key: b.dataset.camp });
    if (!res || !res.ok) return say((res && res.error) || "could not switch", "var(--warn)");
    say(`${res.campaign.name} — ${res.rooms} rooms that take a post. ${res.note}`, "var(--go)");
    drawCampaigns(); drawPlan();
  });
  $$("#campGrid button[data-q]").forEach((b) => b.onclick = () => { const d = $("#q-" + b.dataset.q); d.hidden = !d.hidden; });
  if ($("#campOff")) $("#campOff").onclick = async () => { await send({ type: "v2-campaign-set", key: "" }); say("back to all 191 rooms", "var(--dim)"); drawCampaigns(); };
  if ($("#campPlan")) $("#campPlan").onclick = () => { $$("nav button").find((x) => x.dataset.tab === "plan").click(); $("#mkPlan").click(); };
}

// ------------------------------------------------------------- my posts
const VERDICT_COLOR = { boost: "var(--go)", watch: "var(--warn)", thin: "var(--dim)", quiet: "var(--faint)", stale: "var(--faint)" };
let MINE = null;
async function drawMine() {
  MINE = await send({ type: "v2-mine", opts: { source: $("#mSource").value, sub: $("#mSub").value, sort: $("#mSort").value } });
  if (!MINE || !MINE.ok) return;
  const c = MINE.counts;
  $("#mineStat").innerHTML = [["Posts", c.total], ["From the board", c.board], ["By hand", c.outside], ["Comments earned", c.comments], ["Worth boosting", c.shortlist], ["Removed", c.removed]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  $("#mineWhen").textContent = MINE.lastMine ? `read ${ago(MINE.lastMine)} ago · ${MINE.comments30} comments left in the last 30 days` : "not read yet — press Read my posts";
  const cur = $("#mSub").value;
  $("#mSub").innerHTML = `<option value="">every room</option>` + (MINE.subs || []).map((x) => `<option value="${esc(x)}" ${x === cur ? "selected" : ""}>r/${esc(x)}</option>`).join("");
  $("#mineRows").innerHTML = (MINE.rows || []).map((p) => `<tr class="${p.removed ? "done" : ""}">
    <td><b style="color:${VERDICT_COLOR[p.boost.verdict] || "var(--dim)"}">${esc(p.boost.verdict)}</b><div class="faint">${p.boost.score}</div></td>
    <td class="faint">r/${esc(p.sub)}<div>${p.source === "board" ? "board" : "by hand"}</div></td>
    <td><a href="${esc(p.permalink)}" target="_blank" class="ttl">${esc(p.title)}</a><div class="faint">${esc(p.boost.why)}</div>${p.removed ? `<div class="issue">⚠ removed by a moderator</div>` : ""}</td>
    <td>${p.score}</td><td><b>${p.comments}</b></td><td>${p.hot || 0}</td><td class="faint">${ago(p.created)}</td>
    <td>${p.running ? `<span class="tag t-magnet">boosting</span>` : p.boost.verdict === "boost" || p.boost.verdict === "watch" ? `<button class="act" data-b="${esc(p.id)}">boost</button>` : ""}</td></tr>`).join("")
    || `<tr><td colspan="8" class="faint">No posts read yet. Press Read my posts — it pulls everything this account has ever posted, board or not.</td></tr>`;
  $$("#mineRows button[data-b]").forEach((b) => b.onclick = () => startBoost(b.dataset.b));
}
["mSource", "mSub", "mSort"].forEach((id) => $("#" + id).onchange = drawMine);
$("#readMine").onclick = async () => {
  $("#readMine").disabled = true; say("reading everything this account has posted…");
  const r = await send({ type: "v2-mine-read" });
  $("#readMine").disabled = false;
  if (!r || !r.ok) return say((r && r.error) || "could not read them", "var(--warn)");
  say(`u/${r.user}: ${r.read} posts read, ${r.added} new, ${r.comments30} comments in the last 30 days`, "var(--go)");
  drawMine(); drawBoost(); drawPlan();
};

// --------------------------------------------------------------- boosting
async function startBoost(id) {
  const r = await send({ type: "v2-boost-add", id, daily: +$("#budget").value || 7, days: 7 });
  if (!r || !r.ok) return say((r && r.error) || "could not start it", "var(--warn)");
  const p = r.plan;
  say(`boosting into ${p.room} at $${p.daily} a day for ${p.days} days — $${p.total} in total. ${p.judge}.`, "var(--go)");
  $$("nav button").find((x) => x.dataset.tab === "boost").click();
}
async function drawBoost() {
  const r = await send({ type: "v2-boosts" });
  if (!r || !r.ok) return;
  $("#budget").value = r.dailyBudget || 7;
  const money = r.overall.spent
    ? `<div class="card"><h3>What the money has bought</h3><div class="stat" style="margin:8px 0 0">
        <div><b>$${r.overall.spent}</b><span>spent</span></div>
        <div><b>${r.overall.got}</b><span>comments bought</span></div>
        <div><b>$${r.overall.per}</b><span>per comment</span></div></div>
        <div class="faint" style="margin-top:8px">Under $3 a comment is working. Over $6 and the post is not the one — stop it and take the next off the shortlist.</div></div>`
    : "";
  const running = r.running.length ? `<div class="card"><h3>Running</h3>
    <table style="margin-top:8px"><thead><tr><th>Post</th><th style="width:110px">Room</th><th style="width:90px">Budget</th><th style="width:130px">Spent</th><th style="width:110px">Comments</th><th style="width:210px">Verdict</th></tr></thead>
    <tbody>${r.running.map((b) => `<tr class="${b.state === "stopped" ? "done" : ""}">
      <td><a href="${esc(b.permalink)}" target="_blank">${esc(String(b.title).slice(0, 70))}</a></td>
      <td class="faint">r/${esc(b.sub)}</td>
      <td class="faint">$${b.daily}/day × ${b.days}</td>
      <td><input type="number" data-spend="${esc(b.id)}" value="${b.spent || 0}" min="0" step="1" style="width:74px"> <span class="faint">$</span></td>
      <td>${b.commentsAtStart} → <b>${b.commentsNow}</b><div class="faint">+${b.cost.got}</div></td>
      <td><b style="color:${b.cost.stop ? "var(--warn)" : "var(--go)"}">${b.cost.per ? "$" + b.cost.per + " each" : "—"}</b><div class="faint">${esc(b.cost.verdict)}</div>
        ${b.state === "running" ? `<button class="ghost" data-stop="${esc(b.id)}" style="margin-top:6px">stop it</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : "";
  const short = r.shortlist.length ? `<div class="card"><h3>Worth the money</h3>
    <div class="faint">${esc(r.plan.rule)} · ${esc(r.plan.target)}</div>
    <table style="margin-top:8px"><thead><tr><th style="width:86px">Verdict</th><th style="width:110px">Room</th><th>Post</th><th style="width:88px">Comments</th><th style="width:76px">An hour</th><th style="width:110px"></th></tr></thead>
    <tbody>${r.shortlist.map((p) => `<tr>
      <td><b style="color:${VERDICT_COLOR[p.boost.verdict]}">${esc(p.boost.verdict)}</b></td>
      <td class="faint">r/${esc(p.sub)}</td>
      <td><a href="${esc(p.permalink)}" target="_blank">${esc(String(p.title).slice(0, 80))}</a><div class="faint">${esc(p.boost.advice)}</div></td>
      <td><b>${p.comments}</b></td><td class="faint">${p.boost.perHour}</td>
      <td><button class="act" data-b2="${esc(p.id)}">boost</button></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="card"><h3>Nothing to boost yet</h3><div class="faint">A post reaches the shortlist once it has at least ${V2.BOOST_MIN_COMMENTS} comments and is under a week old. Press <b>Read my posts</b> on the My posts tab first — the shortlist is built from real comment counts, not from what the board expected.</div></div>`;
  $("#boostBody").innerHTML = money + short + running + adsPlanHtml();
  $$("#boostBody button[data-b2]").forEach((b) => b.onclick = () => startBoost(b.dataset.b2));
  $$("#boostBody button[data-stop]").forEach((b) => b.onclick = async () => { await send({ type: "v2-boost-stop", id: b.dataset.stop, why: "stopped by hand" }); drawBoost(); });
  $$("#boostBody input[data-spend]").forEach((i) => i.onchange = async () => { await send({ type: "v2-boost-spend", id: i.dataset.spend, spent: +i.value }); drawBoost(); });
}
$("#saveBudget").onclick = async () => { await send({ type: "v2-budget", daily: +$("#budget").value }); say("budget saved", "var(--go)"); drawBoost(); };

// ------------------------------------------------------------------- boot
(async function boot() {
  try { $("#ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (_) { /* opened as a file */ }
  await drawPlan();
  const tab = (location.hash || "#camp").slice(1);
  const b = $$("nav button").find((x) => x.dataset.tab === tab);
  if (b) b.click();
})();
