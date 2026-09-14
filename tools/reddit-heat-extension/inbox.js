// Inbox page: conversations only. Replies are drafted by the instructions,
// filled into Reddit Chat by the bridge, sent by you.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.round(m / 60) + "h ago";
  return Math.round(m / 1440) + "d ago";
}
async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  if (!btn) return;
  const was = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = was; }, 1200);
}
let profile = {};
function applyTheme(t) { document.body.classList.toggle("light", t === "light"); $("theme").textContent = t === "light" ? "☾ dark" : "☀ light"; }
document.addEventListener("DOMContentLoaded", () => { $("theme").onclick = async () => { const t = document.body.classList.contains("light") ? "dark" : "light"; await chrome.storage.local.set({ theme: t }); applyTheme(t); }; });
function engine() {
  const e = profile.aiEngine;
  if (e === "claude" || e === "chrome" || e === "templates") return e;
  return profile.apiKey ? "claude" : "templates";
}
// sort + filter state, remembered per browser
let ibFilter = "needs", ibSort = "needs", ibFind = "";
try { ibFilter = localStorage.getItem("ibFilter") ?? "needs"; ibSort = localStorage.getItem("ibSort") || "needs"; } catch (_) { /* fine */ }
const STATUS_RANK = { agreed: 0, interested: 1, offered: 2, qualifying: 3, lost: 4, cut: 5 };
function theirs(t) { return (t.messages || []).filter((m) => !m.mine).length; }
function visibleThreads() {
  let list = inboxThreads.slice();
  const st = (t) => (t.deal && t.deal.status) || "qualifying";
  if (ibFilter === "needs") list = list.filter((t) => t.needsReply);
  else if (ibFilter === "handled") list = list.filter((t) => t.handled && st(t) !== "cut");
  else if (ibFilter) list = list.filter((t) => st(t) === ibFilter);
  if (ibFind) { const q = ibFind.toLowerCase(); list = list.filter((t) => (t.with + " " + ((t.post && t.post.title) || "") + " " + t.messages.map((m) => m.body).join(" ")).toLowerCase().includes(q)); }
  const by = {
    needs: (a, b) => (b.needsReply ? 1 : 0) - (a.needsReply ? 1 : 0) || b.lastAt - a.lastAt,
    replies: (a, b) => theirs(b) - theirs(a) || b.lastAt - a.lastAt,
    recent: (a, b) => b.lastAt - a.lastAt,
    status: (a, b) => (STATUS_RANK[st(a)] ?? 9) - (STATUS_RANK[st(b)] ?? 9) || b.lastAt - a.lastAt,
    oldest: (a, b) => (b.needsReply ? 1 : 0) - (a.needsReply ? 1 : 0) || a.lastAt - b.lastAt,
  };
  return list.sort(by[ibSort] || by.needs);
}

// ===========================================================================
// INBOX
// ===========================================================================
let inboxThreads = [];
let curThread = null;
let inboxPlan = "";
let inboxDeal = null;
let inboxDeals = [];
let inboxSummary = null;
let draftBusy = "";
async function inboxRefresh() {
  const r = await send({ type: "inbox-list" });
  if (!r) return;
  inboxThreads = r.threads; inboxPlan = r.plan; inboxDeal = r.deal; inboxDeals = r.deals || []; inboxSummary = r.summary;
  $("sDeals").textContent = inboxSummary ? `${inboxSummary.interested + inboxSummary.agreed} in · ${inboxSummary.cut} cut` : "";
  if (!$("dealsBox").hidden) renderDeals();
  $("sInbox").textContent = r.needs;
  $("inboxStatus").textContent = r.lastError ? "last check failed: " + r.lastError
    : r.lastPoll ? `checked ${ago(r.lastPoll)} · Reddit returned ${r.rawCount} message${r.rawCount === 1 ? "" : "s"} · ${r.needs} waiting for a reply${r.rawCount === 0 ? " · if the answer came in Chat, use Paste a reply I got" : ""}` : "not checked yet";
  const shown = visibleThreads();
  $("ibCount").textContent = `${shown.length} of ${inboxThreads.length}`;
  $("sDealsTop").textContent = inboxSummary ? `${inboxSummary.interested + inboxSummary.agreed} in · ${inboxSummary.cut} cut` : "";
  $("threadList").innerHTML = shown.length ? shown.map((t) => `<div class="thr ${t.needsReply ? "needs" : ""} ${t.handled && t.repliedAt ? "filled" : ""} ${curThread && curThread.id === t.id ? "on" : ""}" data-id="${t.id}"><b>${esc(t.with)}</b><span>${esc((t.post && t.post.title) || t.subject || "").slice(0, 70)}</span><br><span>${theirs(t)} from them · ${t.messages.length} total · ${ago(t.lastAt)}${t.needsReply ? " · needs a reply" : t.handled && t.repliedAt ? " · filled ✓" : t.handled ? " · handled" : ""}${t.deal && t.deal.status ? " · " + t.deal.status.toUpperCase() : ""}</span></div>`).join("")
    : `<div class="empty" style="padding:30px 12px">${inboxThreads.length ? "Nothing matches this filter." : "No conversations yet. They appear here once someone answers a DM."}</div>`;
  for (const el of $("threadList").querySelectorAll(".thr")) el.onclick = () => openThread(el.dataset.id);
  if (curThread) {
    const fresh = inboxThreads.find((t) => t.id === curThread.id);
    // never let a refresh wipe a draft that is on screen or being written
    if (fresh) { curThread = { ...fresh, draft: fresh.draft || curThread.draft }; renderThread(); }
  }
}
async function openThread(id) {
  curThread = inboxThreads.find((t) => t.id === id) || null;
  for (const el of $("threadList").querySelectorAll(".thr")) el.classList.toggle("on", el.dataset.id === id);
  renderThread();
  await draftWrite(false);
}
function renderThread() {
  const t = curThread;
  $("threadEmpty").hidden = !!t; $("threadView").hidden = !t;
  if (!t) return;
  $("threadMeta").innerHTML = `<b>${esc(t.with)}</b> · ${t.messages.length} messages${t.post ? ` · from <a href="#" style="color:#8ab4ff">r/${esc(t.post.sub)}: ${esc(t.post.title).slice(0, 60)}</a>` : ""}`;
  $("threadMsgs").innerHTML = t.messages.map((m) => `<div class="msg ${m.mine ? "mine" : ""}"><small>${m.mine ? "me" : esc(m.author)} · ${ago(m.at)}</small>${esc(m.body)}</div>`).join("");
  $("threadMsgs").scrollTop = 1e6;
  const d = t.draft;
  const stage = d ? (INBOX_STAGES.find((s) => s.key === d.stage) || {}).label : "";
  $("draftStage").textContent = (stage || "") + (d && d.verdict === "not_interested" ? " · CUT" : d && d.verdict === "interested" ? " · INTERESTED" : "");
  $("draftNote").textContent = d && d.note ? d.note : "";
  $("draft").value = d ? d.reply : "";
  $("draftRedo").hidden = !d || engine() === "templates";
  $("sentByHand").hidden = !(t.manual || t.chat);
  $("goReply").textContent = t.chat ? "Fill the reply in Chat ↗" : t.manual ? "Copy + open their chat ↗" : "Open the reply, filled in ↗";
  $("draftState").textContent = d ? (d.engine === "claude" ? `written by Claude${d.cents ? " · " + d.cents + "¢" : ""}` : d.engine === "chrome" ? "written by Chrome, on-device" : "template") : (draftBusy === t.id ? "writing…" : "");
  $("draftState").style.color = d ? "#7ee29a" : "#e6c76b";
}
async function draftWrite(force) {
  const t = curThread;
  if (!t || (t.draft && !force) || draftBusy === t.id) return;
  const eng = engine();
  draftBusy = t.id; renderThread();
  let draft = null, err = "";
  try {
    if (eng === "claude" && profile.apiKey) {
      const r = await send({ type: "inbox-ai", id: t.id, force: !!force });
      if (r && r.ok) draft = r.draft; else err = (r && r.error) || "no answer";
    } else if (eng === "chrome") {
      const pr = await send({ type: "inbox-prompt", id: t.id });
      const session = await LanguageModel.create({ initialPrompts: [{ role: "system", content: pr.system }] });
      try { const out = JSON.parse(await session.prompt(pr.user, { responseConstraint: pr.schema })); draft = inboxAiClean(out); if (draft) draft.engine = "chrome"; else err = "failed the checks"; }
      finally { if (session.destroy) session.destroy(); }
    }
  } catch (e) { err = String(e && e.message || e); }
  if (!draft) { draft = inboxTemplateReply(t, profile, inboxPlan, inboxDeal); draft.engine = "template"; if (err) draft.note = "AI failed (" + err + "), template used. " + draft.note; }
  await send({ type: "inbox-act", id: t.id, action: "draft", patch: draft });
  t.draft = draft; draftBusy = "";
  renderThread();
}
$("draftRedo").onclick = () => draftWrite(true);
$("goReply").onclick = async () => {
  const t = curThread; if (!t) return;
  const text = $("draft").value;
  await copyText(text);
  if (t.chat) {
    const r = await send({ type: "chat-fill", with: t.with, text });
    $("draftState").textContent = r && r.ok ? "filled in Chat — read it there and press send" : "could not fill: " + ((r && r.error) || "no answer") + " (it is on your clipboard)";
    $("draftState").style.color = r && r.ok ? "#7ee29a" : "#ff8a65";
    if (r && r.ok && $("assumeSent").checked) { await send({ type: "inbox-mine", id: t.id, body: text }); curThread = null; inboxRefresh(); renderThread(); }
    return;
  }
  if (t.manual) { window.open("https://chat.reddit.com/user/" + encodeURIComponent(t.with), "_blank"); return; }   // chat: paste with ⌘V
  const last = [...t.messages].reverse().find((m) => !m.mine) || t.messages[t.messages.length - 1];
  await chrome.storage.local.set({ pendingMessage: { threadId: t.id, replyTo: last && last.id, text, at: Date.now() } });
  window.open("https://old.reddit.com/message/messages/" + t.id.replace(/^t4_/, ""), "_blank");
};
$("copyReply").onclick = () => copyText($("draft").value, $("copyReply"));
$("sentByHand").onclick = async () => { if (!curThread) return; await send({ type: "inbox-mine", id: curThread.id, body: $("draft").value }); curThread = null; inboxRefresh(); renderThread(); };
$("openChat").onclick = () => send({ type: "chat-open" });
$("chatDump").onclick = async () => {
  const d = await send({ type: "chat-dump" });
  const s = JSON.stringify(d, null, 1);
  await copyText(s, $("chatDump"));
  $("chatStatus").textContent = d && d.error ? d.error : `copied · composer: ${d.composer} · with: ${d.with || "?"} · ${d.messages.length} messages seen`;
};
async function chatStatus() {
  const s = await send({ type: "chat-status" });
  if (!s) return;
  $("chatStatus").textContent = s.open ? `Chat tab open${s.seen ? " · last read " + ago(s.seen) : " · nothing read yet — open a conversation in it"}` : "no Chat tab — click Open Reddit Chat and keep it open";
  $("chatStatus").style.color = s.open ? "" : "#ff8a65";
}
$("openAdd").onclick = () => { $("addBox").hidden = !$("addBox").hidden; $("planBox").hidden = true; };
$("addGo").onclick = async () => {
  const r = await send({ type: "inbox-add", with: $("addUser").value, body: $("addBody").value });
  if (!r || !r.ok) { $("addMsg").textContent = (r && r.error) || "could not add"; return; }
  $("addMsg").textContent = "added"; $("addBody").value = ""; $("addBox").hidden = true;
  await inboxRefresh(); openThread(r.id);
};
$("threadHandled").onclick = async () => { if (!curThread) return; await send({ type: "inbox-act", id: curThread.id, action: "handled" }); curThread = null; inboxRefresh(); renderThread(); };
$("threadSkip").onclick = async () => { if (!curThread) return; await send({ type: "inbox-act", id: curThread.id, action: "skip" }); curThread = null; inboxRefresh(); renderThread(); };
// Draft every conversation that is waiting, so opening one is instant.
$("draftAll").onclick = async () => {
  const waiting = inboxThreads.filter((t) => t.needsReply && !t.draft);
  let n = 0;
  for (const t of waiting) { $("draftAll").textContent = `Drafting ${n + 1}/${waiting.length}…`; const r = await send({ type: "chat-draft", id: t.id }); if (r && r.ok) n += 1; }
  $("draftAll").textContent = "Draft all waiting"; await inboxRefresh();
  $("inboxStatus").textContent = `${n} draft${n === 1 ? "" : "s"} ready`;
};
$("assumeSent").onchange = () => chrome.storage.local.set({ assumeSent: $("assumeSent").checked });
$("inboxCheck").onclick = async () => { $("inboxStatus").textContent = "checking…"; await send({ type: "inbox-poll" }); inboxRefresh(); };
$("toHunt").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("hunt.html") });
for (const b of document.querySelectorAll("#ibFilter button")) b.onclick = () => { ibFilter = b.dataset.v; try { localStorage.setItem("ibFilter", ibFilter); } catch (_) {} for (const x of document.querySelectorAll("#ibFilter button")) x.classList.toggle("on", x === b); inboxRefresh(); };
$("ibSort").onchange = () => { ibSort = $("ibSort").value; try { localStorage.setItem("ibSort", ibSort); } catch (_) {} inboxRefresh(); };
$("ibFind").oninput = () => { ibFind = $("ibFind").value.trim(); inboxRefresh(); };
$("openPlan").onclick = () => {
  $("planBox").hidden = !$("planBox").hidden; $("addBox").hidden = true; $("dealsBox").hidden = true;
  $("planText").value = inboxPlan || INBOX_PLAN_DEFAULT;
  const d = inboxDeal || DEAL_DEFAULT;
  $("dMode").value = DEAL_MODES.some((m) => m.key === d.mode) ? d.mode : "split"; $("dNums").checked = !!d.numbersInDm;
  $("dUp").value = d.upfront; $("dShare").value = d.share; $("dExp").value = d.expenseShare; $("dTeam").value = d.teamDoes || ""; $("dDisq").value = d.disqualify || "";
};
for (const m of DEAL_MODES) { const o = document.createElement("option"); o.value = m.key; o.textContent = m.label; $("dMode").appendChild(o); }
$("planSave").onclick = async () => {
  inboxPlan = $("planText").value.trim();
  const deal = { mode: $("dMode").value, numbersInDm: $("dNums").checked, upfront: Number($("dUp").value) || DEAL_DEFAULT.upfront, share: Number($("dShare").value) || DEAL_DEFAULT.share, expenseShare: Number($("dExp").value) || DEAL_DEFAULT.expenseShare, teamDoes: $("dTeam").value.trim() || DEAL_DEFAULT.teamDoes, disqualify: $("dDisq").value.trim() || DEAL_DEFAULT.disqualify };
  await send({ type: "inbox-plan", plan: inboxPlan });
  await send({ type: "inbox-terms", deal });
  inboxDeal = deal;
  $("planMsg").hidden = false; setTimeout(() => { $("planMsg").hidden = true; }, 1400);
};
$("planReset").onclick = () => { $("planText").value = INBOX_PLAN_DEFAULT; const d = DEAL_DEFAULT; $("dMode").value = d.mode; $("dNums").checked = false; $("dUp").value = d.upfront; $("dShare").value = d.share; $("dExp").value = d.expenseShare; $("dTeam").value = d.teamDoes; $("dDisq").value = d.disqualify; };

// ---- the deals database ---------------------------------------------------
const DEAL_STATUSES = ["qualifying", "offered", "interested", "agreed", "cut", "lost"];
function renderDeals() {
  const s = inboxSummary || {};
  $("dealsSummary").textContent = `${s.interested || 0} interested · ${s.agreed || 0} agreed · ${s.cut || 0} cut · avg share ${s.avgShare || 0}% · upfront agreed $${s.upfrontTotal || 0}`;
  $("dealsRows").innerHTML = inboxDeals.length ? inboxDeals.map((d) => `<tr data-id="${d.id}"><td><b>${esc(d.with)}</b><br><span style="color:#98a0b3">${d.messages} msgs · ${ago(d.lastAt)}</span></td><td>${esc(d.post || "—").slice(0, 50)}</td>
    <td><select data-f="status" style="background:#0d0f14;color:#e8eaf0;border:1px solid #262b36;border-radius:6px;padding:3px">${DEAL_STATUSES.map((x) => `<option value="${x}" ${x === d.status ? "selected" : ""}>${x}</option>`).join("")}</select></td>
    <td><input data-f="share" type="text" value="${esc(d.share)}" style="width:52px"></td><td><input data-f="upfront" type="text" value="${esc(d.upfront)}" style="width:70px"></td>
    <td>${esc(d.budget || "?")}</td><td>${esc(d.shareOk || "?")}</td><td><input data-f="note" type="text" value="${esc(d.note)}" style="width:160px" placeholder="note"></td></tr>`).join("")
    : `<tr><td colspan="8" style="color:#98a0b3">No conversations yet.</td></tr>`;
  for (const el of $("dealsRows").querySelectorAll("[data-f]")) el.onchange = async () => {
    const id = el.closest("tr").dataset.id; const f = el.dataset.f;
    const patch = {}; patch[f] = f === "share" || f === "upfront" ? Number(el.value) || 0 : el.value;
    await send({ type: "inbox-deal", id, patch }); inboxRefresh();
  };
}
$("openDeals").onclick = async () => { $("dealsBox").hidden = !$("dealsBox").hidden; $("planBox").hidden = true; $("addBox").hidden = true; await inboxRefresh(); renderDeals(); };
$("dealsCopy").onclick = () => copyText(inboxDeals.map((d) => `${d.with}\t${d.status}\t${d.share}%\t$${d.upfront}\tbudget ${d.budget || "?"}\tshare ${d.shareOk || "?"}\t${d.post}\t${d.note}`).join("\n"), $("dealsCopy"));


(async () => {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  profile = config.profile || {};
  const { assumeSent = true, theme = "dark" } = await chrome.storage.local.get(["assumeSent", "theme"]);
  $("assumeSent").checked = assumeSent !== false;
  applyTheme(theme);
  for (const x of document.querySelectorAll("#ibFilter button")) x.classList.toggle("on", x.dataset.v === ibFilter);
  $("ibSort").value = ibSort;
  await inboxRefresh(); chatStatus();
  send({ type: "inbox-poll" }).then(inboxRefresh);
  setInterval(() => { send({ type: "inbox-poll" }).then(inboxRefresh); chatStatus(); }, 60000);
  setInterval(inboxRefresh, 10000);
})();
