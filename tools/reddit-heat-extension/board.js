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
  const s = BOARD.settings || {};
  $("#days").value = s.days || 30; $("#kinds").value = s.kinds || "all";
  $("#magnetEvery").value = s.magnetEvery || 4; $("#cool").value = s.subCoolDays || 14;
  $("#planRows").innerHTML = (BOARD.rows || []).map((r) => {
    if (r.skipped) return `<tr><td>${r.n}</td><td class="faint">${when(r.at)}</td><td colspan="4" class="faint">${esc(r.why)}</td></tr>`;
    const tag = r.magnet ? `<span class="tag t-magnet">offer</span>` : `<span class="tag t-value">value</span>`;
    const wk = r.weekly ? ` <span class="tag t-weekly">weekly thread</span>` : "";
    const what = r.magnet ? esc(r.offerName) : esc(r.typeName);
    const title = r.draft ? `<div class="ttl">${esc(r.draft.title)}</div><div class="faint">${r.draft.words} words${r.draft.issues.length ? " · " + r.draft.issues.length + " to fix" : ""}</div>` : `<span class="faint">not written yet</span>`;
    const btns = r.state === "posted"
      ? `<a href="${esc(r.url || "#")}" target="_blank">open the post</a>`
      : `<button class="ghost" data-w="${r.n}">${r.draft ? "rewrite" : "write it"}</button>
         ${r.draft ? `<button class="ghost" data-v="${r.n}">read</button><button class="act" data-o="${r.n}">post it</button><button class="ghost" data-m="${r.n}">it is live</button>` : ""}
         <button class="ghost" data-s="${r.n}">skip</button>`;
    return `<tr class="${r.state === "posted" || r.state === "skipped" ? "done" : ""}">
      <td>${r.n}</td><td class="faint">${when(r.at)}</td>
      <td><b>r/${esc(r.sub)}</b>${wk}<div class="faint">${esc(r.kind === "ads" ? "already spending" : r.kind === "owner" ? "business owner" : "general")}</div></td>
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
  const r = await send({ type: "v2-plan", opts: { days: +$("#days").value, kinds: $("#kinds").value, magnetEvery: +$("#magnetEvery").value, subCoolDays: +$("#cool").value } });
  if (!r || !r.ok) return say((r && r.error) || "could not build it", "var(--warn)");
  say(`${r.rows.length} days across ${r.rooms} rooms — ${r.magnets} offer days, ${r.values} value days`, "var(--go)");
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

// --------------------------------------------------------------- reference
function drawOffers() {
  $("#offerGrid").innerHTML = V2.OFFERS.map((o) => `<div class="card">
    <h3>${esc(o.name)}</h3>
    <div class="faint">${esc(o.spots)} spots · ${esc(o.channel.replace(/_/g, " "))}</div>
    <ul class="tight">
      <li><b>Who:</b> ${esc(o.who)}</li>
      <li><b>They get:</b> ${esc(o.gift)}</li>
      <li><b>We ask for:</b> ${esc(o.ask)}</li>
      <li><b>Their risk:</b> ${esc(o.risk)}</li>
    </ul></div>`).join("");
}
async function drawTargets() {
  const r = await send({ type: "v2-targets" });
  const checked = (r && r.checked) || {};
  $("#checkWhen").textContent = Object.keys(checked).length ? Object.keys(checked).length + " checked against Reddit" : "not checked yet";
  $("#tRows").innerHTML = V2.TARGETS.map((t) => {
    const c = checked[t.sub];
    const kind = t.kind === "ads" ? "already spending" : t.kind === "owner" ? "business owner" : "general business";
    const promo = (V2.PROMO[t.promo] || {}).name;
    const members = c ? (c.ok ? (c.members || 0).toLocaleString() : `<span style="color:var(--warn)">${esc(c.why)}</span>`) : `<span class="faint">—</span>`;
    return `<tr><td><a href="https://www.reddit.com/r/${esc(t.sub)}/" target="_blank">r/${esc(t.sub)}</a></td>
      <td class="faint">${kind}</td><td class="faint">${esc(promo)}</td><td>${members}</td><td class="faint">${esc(t.note)}</td></tr>`;
  }).join("");
}
$("#checkT").onclick = async () => {
  say("asking Reddit about every room — this takes a minute…");
  const r = await send({ type: "v2-check-targets" });
  say(r && r.ok ? `${r.checked} rooms confirmed, ${r.failed} could not be read` : "could not check", "var(--go)");
  drawTargets();
};
function drawAds() {
  const a = V2.ADS_PLAN;
  $("#adsBody").innerHTML = `<div class="note">${esc(a.idea)}</div>
    ${a.stages.map((s) => `<div class="card"><h3>${esc(s.name)}</h3><div class="faint">budget: ${esc(s.spend)}</div>
      <ul class="tight"><li><b>Do:</b> ${esc(s.does)}</li><li><b>Out:</b> ${esc(s.out)}</li></ul></div>`).join("")}
    <div class="card"><h3>Targeting</h3><ul class="tight">${a.targeting.map((t) => `<li><b>${esc(t.name)}:</b> ${esc(t.how)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Formats</h3><ul class="tight">${a.formats.map((t) => `<li><b>${esc(t.name)}:</b> ${esc(t.note)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Rules that decide whether this works</h3><ul class="tight">${a.rules.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    <div class="card"><h3>The test budget</h3><ul class="tight"><li>${esc(a.budget.test)}</li><li>${esc(a.budget.verdict)}</li></ul>
    <div class="faint" style="margin-top:8px">Figures here are starting points. Reddit's own ad account shows the real minimums and costs on the day you open it.</div></div>`;
}

// ------------------------------------------------------------------- boot
(async function boot() {
  try { $("#ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (_) { /* opened as a file */ }
  drawOffers(); drawAds();
  await drawPlan();
  const tab = (location.hash || "#plan").slice(1);
  const b = $$("nav button").find((x) => x.dataset.tab === tab);
  if (b) b.click();
})();
