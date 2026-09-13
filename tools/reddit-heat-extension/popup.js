const $ = (id) => document.getElementById(id);
async function load() {
  const { posts = {}, meta = {}, config = {}, lastAutoReload = null } = await chrome.storage.local.get(["posts", "meta", "config", "lastAutoReload"]);
  if (lastAutoReload && Date.now() - lastAutoReload.t < 86400000) $("ver").title = `auto-updated ${lastAutoReload.from} → ${lastAutoReload.to} at ${new Date(lastAutoReload.t).toLocaleTimeString()}`;
  const subs = config.confirmedSubs || [];
  $("confirmed").innerHTML = subs.length ? `<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:6px">Your confirmed subreddits · newest</div>` + subs.map((s) => `<button data-url="https://old.reddit.com/r/${encodeURIComponent(s)}/new/" style="margin-bottom:6px;width:100%">r/${s} · newest posts</button>`).join("") : "";
  document.querySelectorAll("button[data-url]").forEach((b) => { if (!b.dataset.bound) { b.dataset.bound = 1; b.addEventListener("click", () => chrome.tabs.create({ url: b.dataset.url })); } });
  const list = Object.values(posts);
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  $("n-tracked").textContent = list.length;
  $("n-read").textContent = list.filter((p) => p.signals).length;
  $("n-ev").textContent = list.filter((p) => p.signals && (p.signals.lead + p.signals.buyer > 0 || p.signals.closed)).length;
  const last = Math.max(meta.lastPage || 0, meta.lastRun || 0);
  $("last").textContent = last ? "Last collected " + new Date(last).toLocaleString() : "Nothing collected yet. Use the orange panel on any old.reddit.com page.";
}
$("dash").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("sweep").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("sweep.html") }));
$("plan").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("campaign.html") }));
$("reload").addEventListener("click", () => chrome.runtime.reload());
load();
