const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let items = [], profile = {};

function generate(post) {
  const full = valueBombReply(post, profile);
  if ($("style").value === "short") {
    // keep intro, first three steps, and the closing lines
    const parts = full.split("\n\n");
    const stepIdx = parts.findIndex((p) => /^1\. /.test(p));
    const steps = parts.slice(stepIdx, stepIdx + 3);
    return [...parts.slice(0, stepIdx), ...steps, ...parts.slice(parts.findIndex((p, i) => i > stepIdx && !/^\d+\. /.test(p)))].join("\n\n");
  }
  return full;
}

async function load() {
  const { replySelection = [], posts = {}, config = {}, drafts = {} } = await chrome.storage.local.get(["replySelection", "posts", "config", "drafts"]);
  profile = config.profile || {};
  items = replySelection.map((id) => posts[id]).filter(Boolean).map((p) => ({ post: p, text: drafts[p.id] || generate(p), pb: pickPlaybook(p) }));
  render();
}

function render() {
  const list = $("list"); list.innerHTML = "";
  if (!items.length) { list.innerHTML = '<div class="empty">No threads selected. Go back to the dashboard, tick threads, then click "Replies for selected".</div>'; return; }
  for (const it of items) {
    const p = it.post;
    const el = document.createElement("div"); el.className = "item" + (p.replied ? " done" : "");
    el.innerHTML = `
      <div class="head">
        <div><div class="t"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></div><div class="m">r/${esc(p.sub)} · u/${esc(p.author)} · ${new Date(p.created).toLocaleDateString()} · ${p.comments} replies${p.price ? " · " + esc(p.price) : ""}</div></div>
        <div><span class="tag">${esc(it.pb.key)} playbook</span>${p.replied ? '<span class="tag" style="background:var(--good);color:var(--good-t)">replied</span>' : ""}</div>
      </div>
      <div class="body">
        <div><label>Their post</label><div class="post">${esc(p.body || "(no body captured; open the thread to read it)")}</div></div>
        <div><label>Your reply (edit freely)</label><textarea data-id="${esc(p.id)}">${esc(it.text)}</textarea>
          <div class="row">
            <button class="btn primary" data-act="copy">Copy reply</button>
            <a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open thread</a>
            <button class="btn" data-act="regen">Regenerate</button>
            <span class="sp"></span>
            <span class="n" data-count></span>
            <button class="btn ok" data-act="replied">${p.replied ? "Replied ✓" : "Mark replied"}</button>
          </div>
        </div>
      </div>`;
    const ta = el.querySelector("textarea");
    const count = () => { el.querySelector("[data-count]").textContent = `${ta.value.length} chars · ${ta.value.split(/\s+/).filter(Boolean).length} words`; };
    count();
    ta.addEventListener("input", async () => { it.text = ta.value; count(); const { drafts = {} } = await chrome.storage.local.get(["drafts"]); drafts[p.id] = ta.value; await chrome.storage.local.set({ drafts }); });
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.act === "copy") { await navigator.clipboard.writeText(ta.value); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy reply"), 1500); }
      if (b.dataset.act === "regen") { it.text = generate(p); ta.value = it.text; count(); const { drafts = {} } = await chrome.storage.local.get(["drafts"]); delete drafts[p.id]; await chrome.storage.local.set({ drafts }); }
      if (b.dataset.act === "replied") { p.replied = Date.now(); p.status = "replied"; await chrome.runtime.sendMessage({ type: "override", id: p.id, patch: { status: "replied", replied: p.replied } }); render(); }
    }));
    list.appendChild(el);
  }
}

$("style").addEventListener("change", () => { items.forEach((it) => (it.text = generate(it.post))); render(); });
$("regen").addEventListener("click", async () => { await chrome.storage.local.remove("drafts"); items.forEach((it) => (it.text = generate(it.post))); render(); });
$("dash").addEventListener("click", () => { location.href = "dashboard.html"; });
load();
