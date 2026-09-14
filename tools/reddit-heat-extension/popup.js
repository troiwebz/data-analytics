const $ = (id) => document.getElementById(id);
async function load() {
  const { posts = {}, meta = {}, config = {}, lastAutoReload = null } = await chrome.storage.local.get(["posts", "meta", "config", "lastAutoReload"]);
  if (lastAutoReload && Date.now() - lastAutoReload.t < 86400000) $("ver").title = `auto-updated ${lastAutoReload.from} → ${lastAutoReload.to} at ${new Date(lastAutoReload.t).toLocaleTimeString()}`;
  const subs = config.confirmedSubs || [];
  $("confirmed").innerHTML = subs.length ? `<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:6px">Your confirmed subreddits · newest</div>` + subs.map((s) => `<button data-url="https://old.reddit.com/r/${encodeURIComponent(s)}/new/" style="margin-bottom:6px;width:100%">r/${s} · newest posts</button>`).join("") : "";
  document.querySelectorAll("button[data-url]").forEach((b) => { if (!b.dataset.bound) { b.dataset.bound = 1; b.addEventListener("click", () => chrome.tabs.create({ url: b.dataset.url })); } });
  const list = Object.values(posts);
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  $("n-old").textContent = `${list.length} threads · ${list.filter((p) => p.signals && (p.signals.lead + p.signals.buyer > 0 || p.signals.closed)).length} with leads`;
  chrome.runtime.sendMessage({ type: "hunt-queue", limit: 1 }, (r) => {
    if (!r) return;
    $("h-queue").textContent = r.total;
    $("h-today").textContent = r.contactedToday;
    $("h-ever").textContent = r.contactedTotal;
    if (!r.on) $("hunt").textContent = "Co-founder hunt · start watching";
  });
  const last = Math.max(meta.lastPage || 0, meta.lastRun || 0);
  const upd = lastAutoReload ? ` · auto-updated to v${lastAutoReload.to} at ${new Date(lastAutoReload.t).toLocaleTimeString()}` : "";
  $("last").textContent = (last ? "Last collected " + new Date(last).toLocaleString() : "Nothing collected yet. Use the orange panel on any old.reddit.com page.") + upd;
}
$("hunt").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("hunt.html") }));
$("inboxBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("inbox.html") }));
$("advBtn").addEventListener("click", () => { const a = $("adv"); a.hidden = !a.hidden; });
$("dash").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("sweep").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("sweep.html") }));
$("plan").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("campaign.html") }));
$("reload").addEventListener("click", () => chrome.runtime.reload());
load();
