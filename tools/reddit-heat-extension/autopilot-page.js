const $ = (id) => document.getElementById(id);
const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (_) { res(null); } });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const say = (t, ok) => { $("msg").textContent = t; $("msg").className = ok ? "ok" : "bad"; };

async function load() {
  const r = await send({ type: "ap-get" });
  if (!r || !r.ok) { $("state").textContent = "The extension did not answer. Reload it."; return; }
  $("state").textContent = r.on ? "Auto mode is ON" : "Manual mode";
  $("state").className = r.on ? "ok" : "";
  $("turnOn").classList.toggle("sel", !!r.on);
  $("turnOff").classList.toggle("sel", !r.on);
  const bits = [`DMs sent today: ${r.gate.sentToday} of ${r.gate.cap}`];
  if (r.on && r.blocked) bits.unshift("PAUSED: " + r.blocked);
  if (r.on && r.nextAt > Date.now()) bits.push(`next DM allowed in ${Math.ceil((r.nextAt - Date.now()) / 60000)} min`);
  if (r.on && r.watchLeft) bits.push(`the next ${r.watchLeft} open in front of you`);
  if (r.on) bits.push(`${r.screened} screened by Claude since switching on`);
  for (const inp of document.querySelectorAll("[data-r]")) if (document.activeElement !== inp && !inp.dataset.touched) inp.value = r.rules[inp.dataset.r];
  if (r.on) bits.push(`new finds waiting: ${r.waiting}`);
  if (r.job) bits.push(`sending now to u/${r.job.author}`);
  if (r.gate.waitMs > 0) bits.push(`next DM allowed in ${Math.ceil(r.gate.waitMs / 1000)}s`);
  $("detail").textContent = bits.join(" · ");
  const mark = (ok, yes, no) => `<div class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${esc(ok ? yes : no)}</div>`;
  $("checks").innerHTML =
    mark(r.hasKey, "Claude key saved, the screen can run", "No Claude key saved: every post will be skipped. Add it under AI writing on the hunt page.") +
    mark(r.huntOn || !r.on, r.on ? "The hunt is watching for new posts" : "The hunt starts watching when Auto mode is switched on", "The hunt is not watching, so nothing new will be found") +
    // Telegram is optional: it is only mentioned once you have started setting it up
    (r.hasToken ? mark(!r.tgError, "Telegram bot connected", "Telegram: " + r.tgError) + mark(!!r.chatId, "Telegram chat linked", "Telegram chat not linked yet") : "");
  if (r.hasToken && !$("tgBox").dataset.opened) { $("tgBox").open = true; $("tgBox").dataset.opened = "1"; }
  $("token").placeholder = r.hasToken ? "Bot token saved (paste a new one to replace it)" : "Bot token";
  $("chat").textContent = r.chatId ? `Linked chat: ${r.chatId}` : r.seenChat ? `Message received from ${r.seenChat.name} (${r.seenChat.id})` : "No message received from Telegram yet";
  $("link").hidden = !!r.chatId; $("unlink").hidden = !r.chatId;
  $("log").innerHTML = (r.log || []).map((x) => `<tr><td>${esc(new Date(x.at).toLocaleString())}</td><td>${esc(x.what)}</td><td>${x.permalink ? `<a href="${esc(x.permalink)}" target="_blank" rel="noopener">${esc(x.title || x.permalink)}</a>` : ""}${x.who ? ` <span class="hint">u/${esc(x.who)}${x.sub ? " · r/" + esc(x.sub) : ""}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="hint">Nothing yet.</td></tr>`;
}

for (const inp of document.querySelectorAll("[data-r]")) inp.oninput = () => { inp.dataset.touched = "1"; };
$("saveRules").onclick = async () => {
  const rules = {};
  for (const inp of document.querySelectorAll("[data-r]")) rules[inp.dataset.r] = inp.value.trim();
  const r = await send({ type: "ap-rules", rules });
  for (const inp of document.querySelectorAll("[data-r]")) delete inp.dataset.touched;
  $("rulesMsg").textContent = r && r.ok ? "Saved." : "Could not save.";
  load();
};
$("turnOn").onclick = async () => { await send({ type: "ap-turn", on: true }); load(); };
$("turnOff").onclick = async () => { await send({ type: "ap-turn", on: false }); load(); };
$("save").onclick = async () => {
  const token = $("token").value.trim();
  if (!token) return say("Paste the bot token first.", false);
  await send({ type: "ap-save", token });
  $("token").value = "";
  const r = await send({ type: "ap-test" });
  say(r && r.ok ? `Saved. Connected to @${r.bot}.` : "Saved, but Telegram said: " + ((r && r.error) || "no answer"), !!(r && r.ok));
  load();
};
$("test").onclick = async () => { const r = await send({ type: "ap-test" }); say(r && r.ok ? (r.sent ? `Test message sent through @${r.bot}.` : `Connected to @${r.bot}. Link a chat to receive messages.`) : "Failed: " + ((r && r.error) || "no answer"), !!(r && r.ok)); };
$("link").onclick = async () => { await send({ type: "ap-tick" }); const r = await send({ type: "ap-link" }); say(r && r.ok ? "Chat linked." : (r && r.error) || "Could not link.", !!(r && r.ok)); load(); };
$("unlink").onclick = async () => { await send({ type: "ap-unlink" }); say("Chat unlinked.", true); load(); };

load();
setInterval(load, 5000);
