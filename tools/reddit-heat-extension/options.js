const $ = (id) => document.getElementById(id);
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

async function load() {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  $("keywords").value = (config.keywords && config.keywords.length ? config.keywords : DEFAULT_KEYWORDS).join("\n");
  $("subs").value = (config.subs && config.subs.length ? config.subs : DEFAULT_SUBS).join("\n");
  $("interval").value = config.intervalMin || 360;
  $("time").value = config.time || "month";
  $("dives").value = config.commentDives || 60;
  $("autocsv").checked = config.autoCsv !== false;
  count();
}
function count() {
  const k = lines($("keywords").value).length, s = lines($("subs").value).length;
  const req = s * Math.ceil(k / BATCH_SIZE);
  $("kwcount").textContent = `${k} keywords × ${s} subreddits = ${req} requests ≈ ${Math.round(req * 6.5 / 60)} min per run`;
}
$("keywords").addEventListener("input", count);
$("subs").addEventListener("input", count);
$("save").addEventListener("click", async () => {
  const config = {
    keywords: lines($("keywords").value), subs: lines($("subs").value).map((s) => s.replace(/^r\//, "")),
    intervalMin: Math.max(60, Number($("interval").value) || 360), time: $("time").value,
    commentDives: Math.min(200, Math.max(10, Number($("dives").value) || 60)), autoCsv: $("autocsv").checked,
  };
  await chrome.storage.local.set({ config });
  await chrome.runtime.sendMessage({ type: "rearm" });
  $("saved").textContent = "Saved."; setTimeout(() => ($("saved").textContent = ""), 2000);
});
$("reset").addEventListener("click", async () => { await chrome.storage.local.remove("config"); load(); });
load();
