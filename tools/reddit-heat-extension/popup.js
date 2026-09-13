const $ = (id) => document.getElementById(id);
async function load() {
  const { posts = {}, meta = {} } = await chrome.storage.local.get(["posts", "meta"]);
  const list = Object.values(posts);
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  $("n-tracked").textContent = list.length;
  $("n-read").textContent = list.filter((p) => p.signals).length;
  $("n-ev").textContent = list.filter((p) => p.signals && (p.signals.lead + p.signals.buyer > 0 || p.signals.closed)).length;
  const last = Math.max(meta.lastPage || 0, meta.lastRun || 0);
  $("last").textContent = last ? "Last collected " + new Date(last).toLocaleString() : "Nothing collected yet. Use the orange panel on any old.reddit.com page.";
}
$("dash").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
document.querySelectorAll("button[data-url]").forEach((b) => b.addEventListener("click", () => chrome.tabs.create({ url: b.dataset.url })));
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("reload").addEventListener("click", () => chrome.runtime.reload());
load();
