const $ = (id) => document.getElementById(id);
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

async function load() {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  $("clientid").value = config.clientId || "";
  $("pname").value = (config.profile || {}).name || ""; $("prole").value = (config.profile || {}).role || "";
  $("keywords").value = config.keywordText || DEFAULT_KEYWORD_TEXT.trim();
  $("subs").value = (config.subs && config.subs.length ? config.subs : DEFAULT_SUBS).join("\n");
  $("window").value = config.windowDays || 30;
  $("pages").value = config.maxPages || 10;
  $("dives").value = config.commentDives || 150;
  $("interval").value = config.intervalMin || 180;
  $("alsosearch").checked = !!config.alsoSearch;
  $("autocsv").checked = config.autoCsv !== false;
  count();
}

function count() {
  const entries = parseKeywordText($("keywords").value);
  const groups = new Set(entries.map((e) => e.group));
  const subs = lines($("subs").value).length;
  const pages = Number($("pages").value) || 10, dives = Number($("dives").value) || 150;
  const req = subs * pages + dives + ($("alsosearch").checked ? subs * groups.size : 0);
  const oauth = !!$("clientid").value.trim();
  const mins = Math.round(req * (oauth ? 0.7 : 6.5) / 60);
  $("kwcount").textContent = `${entries.length} keywords in ${groups.size} categories · ${subs} subreddits · up to ${req} requests ≈ ${mins} min per run ${oauth ? "(API key)" : "(no API key)"}`;
}
["keywords", "subs", "pages", "dives", "clientid"].forEach((id) => $(id).addEventListener("input", count));
$("alsosearch").addEventListener("change", count);

$("save").addEventListener("click", async () => {
  const { config: prevCfg = {} } = await chrome.storage.local.get(["config"]);
  const config = {
    ...prevCfg,
    profile: { name: $("pname").value.trim(), role: $("prole").value.trim() },
    clientId: $("clientid").value.trim(),
    keywordText: $("keywords").value,
    subs: lines($("subs").value).map((s) => s.replace(/^r\//, "")),
    windowDays: Math.min(365, Math.max(1, Number($("window").value) || 30)),
    maxPages: Math.min(10, Math.max(1, Number($("pages").value) || 10)),
    commentDives: Math.min(500, Math.max(10, Number($("dives").value) || 150)),
    intervalMin: Math.max(30, Number($("interval").value) || 180),
    alsoSearch: $("alsosearch").checked,
    autoCsv: $("autocsv").checked,
  };
  await chrome.storage.local.set({ config });
  await chrome.storage.local.remove("oauth");
  await chrome.runtime.sendMessage({ type: "rearm" });
  $("saved").textContent = "Saved."; $("saved").className = "ok"; setTimeout(() => ($("saved").textContent = ""), 2000);
});

$("testauth").addEventListener("click", async () => {
  const res = $("authres"); res.textContent = "Testing…"; res.className = "";
  const r = await chrome.runtime.sendMessage({ type: "testauth", clientId: $("clientid").value.trim() });
  res.textContent = r && r.ok ? "Works: 100 requests/min." : "Failed: " + ((r && r.error) || "unknown"); res.className = r && r.ok ? "ok" : "bad";
});

$("reset").addEventListener("click", async () => {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  delete config.keywordText; delete config.subs;
  await chrome.storage.local.set({ config }); load();
});
load();
