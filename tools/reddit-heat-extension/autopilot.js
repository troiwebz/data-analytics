// AUTOPILOT — private DMs only, switched on and off from Telegram.
//
// "auto on" in your Telegram chat turns it on, "off" turns it off. While it is
// on, every NEW find of the hunt goes through four gates, in this order:
//   1. not a moderator's post (Reddit's own mark, the pin, or the mod list)
//   2. Claude screens it and writes the DM. No key, an error, a timeout or a
//      "not a fit" all mean the same thing: that thread is not messaged.
//   3. the DM pacing gate (the gap between DMs and the ceiling for the day)
//   4. the chat bridge opens that person's chat, fills the DM and sends it
// It never writes a public comment and never opens a thread to reply in.
//
// Loaded by background.js through importScripts, so huntGet, huntSet,
// huntFetch, huntSlotWrite, huntAiWrite, huntAiKey, dmGate and huntMe are the
// ones defined there.

const AP_ALARM = "autopilot-tick";
const AP_SEND_TIMEOUT_MS = 3 * 60000;     // a chat that has not sent by then is given up on
const AP_MODS_TTL_MS = 24 * 3600000;
const AP_TG = "https://api.telegram.org/bot";

async function apGet() {
  const { autopilot = {} } = await chrome.storage.local.get(["autopilot"]);
  return {
    on: !!autopilot.on,
    token: autopilot.token || "",
    chatId: autopilot.chatId ? String(autopilot.chatId) : "",
    offset: autopilot.offset || 0,
    since: autopilot.since || 0,
    job: autopilot.job || null,
    done: autopilot.done || {},
    mods: autopilot.mods || {},
    log: Array.isArray(autopilot.log) ? autopilot.log : [],
    seenChat: autopilot.seenChat || null,
    capToldOn: autopilot.capToldOn || "",
    tgError: autopilot.tgError || "",
    huntWasOff: !!autopilot.huntWasOff,
  };
}
async function apSet(patch) {
  const { autopilot = {} } = await chrome.storage.local.get(["autopilot"]);
  await chrome.storage.local.set({ autopilot: { ...autopilot, ...patch } });
}
async function apLog(what, p, extra) {
  const st = await apGet();
  const row = { at: Date.now(), what, who: (p && p.author) || "", sub: (p && p.sub) || "", title: AP.clip(p && p.title, 90), permalink: (p && p.permalink) || "", ...(extra || {}) };
  await apSet({ log: [row, ...st.log].slice(0, 200) });
}
// Mark a thread as finished with, so it is never tried twice.
async function apDone(id, why) {
  const st = await apGet();
  const done = { ...st.done, [id]: { at: Date.now(), why } };
  const cutoff = Date.now() - 30 * 86400000;
  for (const [k, v] of Object.entries(done)) if ((v.at || 0) < cutoff) delete done[k];
  await apSet({ done });
}

// ---- Telegram ---------------------------------------------------------------
async function tgCall(token, method, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(AP_TG + token + "/" + method, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: j.description || ("HTTP " + r.status) };
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: /abort/i.test(String(e)) ? "Telegram took more than 15s" : "could not reach Telegram" };
  } finally { clearTimeout(t); }
}
async function tgSay(text, chat) {
  const st = await apGet();
  const to = chat || st.chatId;
  if (!st.token || !to) return { ok: false, error: "Telegram is not set up" };
  return tgCall(st.token, "sendMessage", { chat_id: to, text: String(text).slice(0, 3900), disable_web_page_preview: true });
}
// Read what you typed since last time. Only the linked chat can give orders.
async function apTelegram() {
  const st = await apGet();
  if (!st.token) return;
  const r = await tgCall(st.token, "getUpdates", { offset: st.offset, timeout: 0, allowed_updates: ["message"] });
  if (!r.ok) { if (st.tgError !== r.error) await apSet({ tgError: r.error }); return; }
  if (st.tgError) await apSet({ tgError: "" });
  let offset = st.offset;
  for (const u of r.result || []) {
    offset = Math.max(offset, (u.update_id || 0) + 1);
    const m = u.message;
    if (!m || !m.chat || typeof m.text !== "string") continue;
    const chat = String(m.chat.id);
    // messages older than ten minutes are history, not orders
    if (m.date && Date.now() / 1000 - m.date > 600) continue;
    if (!st.chatId) {
      await apSet({ seenChat: { id: chat, name: [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.username || m.chat.title || chat, at: Date.now() } });
      await tgCall(st.token, "sendMessage", { chat_id: chat, text: "This chat is not linked yet. Open the extension's Autopilot page and press \"Link this chat\". Until then nothing you type here does anything." });
      continue;
    }
    if (chat !== st.chatId) continue;
    const cmd = AP.parseCommand(m.text);
    if (cmd === "on") await apTurn(true, "Telegram");
    else if (cmd === "off") await apTurn(false, "Telegram");
    else if (cmd === "status") await tgSay(await apStatusText());
    else if (cmd === "help") await tgSay("Type \"auto on\" to start, \"off\" to stop, \"status\" to see where it is.\nPrivate DMs only. Nothing is ever posted in public.");
  }
  if (offset !== st.offset) await apSet({ offset });
}

async function apWaiting() {
  const st = await apGet();
  const hunt = await huntGet();
  const ctx = { since: st.since, contacted: hunt.contacted, done: st.done, me: hunt.me, now: Date.now(), maxAgeH: hunt.maxAgeH };
  return Object.values(hunt.posts).filter((p) => !AP.blockReason(p, ctx)).length;
}
async function apStatusText() {
  const st = await apGet();
  const gate = await dmGate();
  const waiting = st.on ? await apWaiting() : undefined;
  let t = AP.statusText(st, gate, waiting);
  if (!(await huntAiKey())) t += "\nNo Claude key is saved, so every thread will be skipped until one is added.";
  return t;
}

// ---- on / off ---------------------------------------------------------------
async function apTurn(on, from) {
  const st = await apGet();
  if (on) {
    const hunt = await huntGet();
    // the hunt is what finds new threads, so it has to be watching
    const patch = { on: true, since: st.on && st.since ? st.since : Date.now(), capToldOn: "" };
    if (!hunt.on) { patch.huntWasOff = true; await huntSet({ on: true }); huntArm(true); }
    await apSet(patch);
    apArm();
    if (!st.on) await apLog("switched ON from " + from);
    const key = await huntAiKey();
    await tgSay("Autopilot is ON.\nNew finds get a private DM, one at a time. Nothing is posted in public." + (key ? "" : "\nNo Claude key is saved, so every thread will be skipped until one is added."));
    return { ok: true, on: true };
  }
  // off means off: drop whatever is in flight, before it sends
  if (st.job) await apAbortJob(st.job, "switched off");
  if (st.huntWasOff) { await huntSet({ on: false }); huntArm(false); }
  await apSet({ on: false, job: null, huntWasOff: false });
  if (st.on) await apLog("switched OFF from " + from);
  await tgSay("Autopilot is OFF. Nothing more will be sent.");
  return { ok: true, on: false };
}
async function apAbortJob(job, why) {
  const { pendingDm } = await chrome.storage.local.get(["pendingDm"]);
  if (pendingDm && pendingDm.auto && pendingDm.id === job.id) await chrome.storage.local.remove("pendingDm");
  if (job.tabId) { try { await chrome.tabs.remove(job.tabId); } catch (_) { /* already closed */ } }
  const hunt = await huntGet();
  await apLog("dropped: " + why, hunt.posts[job.id] || { author: job.author });
}

// ---- moderators -------------------------------------------------------------
async function apMods(sub) {
  const st = await apGet();
  const k = String(sub || "").toLowerCase();
  if (!k) return { known: false, list: [] };
  const c = st.mods[k];
  if (c && Date.now() - c.at < AP_MODS_TTL_MS) return { known: c.known !== false, list: c.list || [] };
  let list = [], known = true;
  try {
    const j = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(sub)}/about/moderators.json?raw_json=1`);
    list = ((j && j.data && j.data.children) || []).map((m) => m && m.name).filter(Boolean);
  } catch (_) { known = false; }
  // a list that could not be read is asked for again in an hour, not a day
  await apSet({ mods: { ...st.mods, [k]: { at: known ? Date.now() : Date.now() - AP_MODS_TTL_MS + 3600000, list, known } } });
  return { known, list };
}

// ---- the run ----------------------------------------------------------------
let apBusy = false;
async function apTick() {
  if (apBusy) return;
  apBusy = true;
  try {
    await apTelegram();
    const st = await apGet();
    if (!st.on) return;
    if (st.job) { await apWatchJob(st.job); return; }
    await apNext();
  } catch (e) {
    try { await apLog("error: " + String((e && e.message) || e)); } catch (_) { /* storage is gone */ }
  } finally { apBusy = false; }
}

// A DM is in flight: has it gone?
async function apWatchJob(job) {
  const hunt = await huntGet();
  const p = hunt.posts[job.id];
  if (p && (p.dmAt || 0) >= job.startedAt) {
    if (job.tabId) { try { await chrome.tabs.remove(job.tabId); } catch (_) { /* closed */ } }
    await apDone(job.id, "sent");
    await apSet({ job: null });
    await apLog("DM sent", p);
    const g = await dmGate();
    await tgSay(`DM sent to u/${p.author} (r/${p.sub})\n${AP.clip(p.title, 120)}\n${p.permalink}\n\n${AP.clip(job.text, 500)}\n\nToday: ${g.sentToday} of ${g.cap}.`);
    return;
  }
  if (Date.now() - job.startedAt < AP_SEND_TIMEOUT_MS) return;
  await apAbortJob(job, "the chat did not send within 3 minutes");
  await apDone(job.id, "send not confirmed");
  await apSet({ job: null });
  await tgSay(`Not sent: u/${job.author}. Reddit Chat did not confirm the DM within 3 minutes, so it was dropped and will not be tried again.\n${(p && p.permalink) || ""}`);
}

async function apSkip(p, why, tell) {
  await apDone(p.id, why);
  await apLog("skipped: " + why, p);
  if (tell !== false) await tgSay(`Skipped u/${p.author} (r/${p.sub}): ${why}\n${AP.clip(p.title, 120)}\n${p.permalink}`);
}

async function apNext() {
  const st = await apGet();
  const hunt = await huntGet();
  const ctx = { since: st.since, contacted: hunt.contacted, done: st.done, me: hunt.me, now: Date.now(), maxAgeH: hunt.maxAgeH };
  const p = AP.pickNext(hunt.posts, ctx);
  if (!p) return;

  // somebody else's DM is already on its way to the chat box: wait for it
  const { pendingDm } = await chrome.storage.local.get(["pendingDm"]);
  if (pendingDm && !pendingDm.done && Date.now() - (pendingDm.at || 0) < 15 * 60000) return;

  // pacing: the gap between DMs and the day's ceiling are the hunt's own
  const gate = await dmGate();
  if (!gate.ok) {
    if (gate.sentToday >= gate.cap) {
      const today = new Date().toDateString();
      if (st.capToldOn !== today) { await apSet({ capToldOn: today }); await tgSay(`Today's ceiling of ${gate.cap} DMs is reached. Autopilot stays on and carries on tomorrow.`); }
    }
    return;
  }

  // gate 1: moderators
  const mods = await apMods(p.sub);
  if (AP.isModPost(p, mods.list)) return apSkip(p, "moderator post", false);

  // gate 2: the Claude screen. It must answer, and it must say yes.
  const key = await huntAiKey();
  if (!key) return apSkip(p, "Claude screen could not run (no Claude key saved)");
  if (!AP.screenedByClaude(p)) {
    const { config = {} } = await chrome.storage.local.get(["config"]);
    const engine = (config.profile || {}).aiEngine;
    let r;
    try { r = engine === "claude" ? await huntAiWrite(p.id, true) : await huntSlotWrite(p.id, true); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.cancelled) return apSkip(p, "Claude screened it out: " + (r.reason || "not a fit"));
    if (!r || !r.ok) return apSkip(p, "Claude screen did not work (" + ((r && r.error) || "no answer") + ")");
  }
  const fresh = (await huntGet()).posts[p.id];
  if (!fresh || fresh.act || fresh.dmAt) return;
  if (!AP.screenedByClaude(fresh)) return apSkip(fresh, fresh.ai && fresh.ai.fit === "no" ? "Claude screened it out: " + (fresh.ai.fit_reason || "not a fit") : "Claude screen did not work (no draft came back)");
  const text = AP.dmText(fresh);
  if (text.length < 40) return apSkip(fresh, "Claude screen did not work (the DM came back empty)");

  // it may have been switched off while Claude was writing
  if (!(await apGet()).on) return;

  // gate 4: hand it to the chat bridge, in a tab of its own
  const startedAt = Date.now();
  await chrome.storage.local.set({ pendingDm: { kind: "hunt", auto: true, id: fresh.id, author: fresh.author, text, at: startedAt } });
  let tabId = 0;
  try { tabId = (await chrome.tabs.create({ url: "https://www.reddit.com/chat/room/create", active: false })).id; }
  catch (e) { await chrome.storage.local.remove("pendingDm"); return apSkip(fresh, "could not open Reddit Chat"); }
  await apSet({ job: { id: fresh.id, author: fresh.author, tabId, startedAt, text } });
  await apLog("sending", fresh);
}

// ---- wiring -----------------------------------------------------------------
async function apArm() {
  const a = await chrome.alarms.get(AP_ALARM);
  if (!a) chrome.alarms.create(AP_ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === AP_ALARM) apTick(); });
chrome.runtime.onInstalled.addListener(() => { apArm(); });
chrome.runtime.onStartup.addListener(() => { apArm(); });
apArm();

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || typeof msg.type !== "string" || msg.type.indexOf("ap-") !== 0) return;
  const fail = (e) => reply({ ok: false, error: String((e && e.message) || e) });
  if (msg.type === "ap-get") { (async () => { const st = await apGet(); const gate = await dmGate(); const hunt = await huntGet(); reply({ ok: true, on: st.on, hasToken: !!st.token, chatId: st.chatId, seenChat: st.seenChat, job: st.job ? { author: st.job.author, startedAt: st.job.startedAt } : null, log: st.log.slice(0, 60), since: st.since, tgError: st.tgError, gate, huntOn: hunt.on, hasKey: !!(await huntAiKey()), waiting: st.on ? await apWaiting() : 0 }); })().catch(fail); return true; }
  if (msg.type === "ap-save") { (async () => { const patch = {}; if (typeof msg.token === "string" && msg.token.trim()) { patch.token = msg.token.trim(); patch.offset = 0; patch.tgError = ""; } if (typeof msg.chatId === "string") patch.chatId = msg.chatId.trim(); await apSet(patch); apArm(); reply({ ok: true }); })().catch(fail); return true; }
  if (msg.type === "ap-link") { (async () => { const st = await apGet(); if (!st.seenChat) return reply({ ok: false, error: "no message has arrived yet — send your bot any message, wait half a minute, then press this again" }); await apSet({ chatId: String(st.seenChat.id) }); const r = await tgSay("This chat is linked. Type \"auto on\" to start and \"off\" to stop."); reply({ ok: true, chatId: String(st.seenChat.id), sent: r.ok }); })().catch(fail); return true; }
  if (msg.type === "ap-test") { (async () => { const st = await apGet(); if (!st.token) return reply({ ok: false, error: "no bot token saved" }); const me = await tgCall(st.token, "getMe", {}); if (!me.ok) return reply({ ok: false, error: me.error }); if (!st.chatId) return reply({ ok: true, bot: me.result.username, sent: false }); const r = await tgSay("Test from the extension: Telegram is connected."); reply({ ok: r.ok, bot: me.result.username, sent: r.ok, error: r.error }); })().catch(fail); return true; }
  if (msg.type === "ap-turn") { apTurn(!!msg.on, "the Autopilot page").then(reply).catch(fail); return true; }
  if (msg.type === "ap-tick") { apTick().then(() => reply({ ok: true })).catch(fail); return true; }
  if (msg.type === "ap-unlink") { apSet({ chatId: "", seenChat: null }).then(() => reply({ ok: true })).catch(fail); return true; }
});
