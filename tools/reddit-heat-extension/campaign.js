const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const openSet = new Set();
let campaign = null; // { ideas: [...], status: 'draft'|'live', startedAt, generatedAt }

async function load(regen = false) {
  const { posts = {}, config = {}, campaign: saved = null } = await chrome.storage.local.get(["posts", "config", "campaign"]);
  const confirmed = config.confirmedSubs || [];
  if (!saved || regen) {
    const fresh = buildIdeas(posts, confirmed);
    const prev = saved ? Object.fromEntries(saved.ideas.map((i) => [i.key, i])) : {};
    campaign = {
      status: saved ? saved.status : "draft", startedAt: saved ? saved.startedAt : null, generatedAt: Date.now(),
      ideas: fresh.map((i) => {
        const p = prev[i.key];
        // keep the user's edits and decisions; refresh evidence and opportunities
        return p ? { ...i, name: p.name, offer: p.offer, price: p.price, title: p.title, body: p.body, targets: p.targets, status: p.status, notes: p.notes, checklist: p.checklist } : { ...i, status: "draft", notes: "", checklist: {} };
      }),
    };
    await save();
  } else campaign = saved;
  render();
}

async function save() { await chrome.storage.local.set({ campaign }); }

function render() {
  const approved = campaign.ideas.filter((i) => i.status === "approved");
  const live = campaign.status === "live";
  $("st2").classList.toggle("on", campaign.ideas.some((i) => i.status !== "draft"));
  $("st3").classList.toggle("on", live);
  const banner = $("banner"); banner.classList.toggle("live", live);
  $("b-title").textContent = live ? `Campaign live since ${new Date(campaign.startedAt).toLocaleDateString()} · ${approved.length} approved offer${approved.length === 1 ? "" : "s"}` : `${campaign.ideas.length} ideas generated · ${approved.length} approved · ${campaign.ideas.filter((i) => i.status === "rejected").length} rejected`;
  $("b-text").textContent = live ? "Work the checklist inside each approved idea. Regenerate any time to refresh evidence; your wording stays." : "Open each idea, edit price and wording, tick target subreddits, then Approve or Reject. Start when you're happy. Nothing is posted automatically.";
  $("start").textContent = live ? "Stop campaign" : `Start campaign with ${approved.length} approved idea${approved.length === 1 ? "" : "s"}`;
  $("start").disabled = !live && approved.length === 0;

  const list = $("list"); list.innerHTML = "";
  if (!campaign.ideas.length) { list.innerHTML = '<div class="empty">No demand scraped yet. Use the Discover searches in the popup first.</div>'; return; }
  campaign.ideas.forEach((idea, idx) => {
    const el = document.createElement("div");
    el.className = `idea ${idea.status} ${openSet.has(idea.key) ? "open" : ""}`;
    const st = idea.status === "approved" ? '<span class="tag t-ok">approved</span>' : idea.status === "rejected" ? '<span class="tag t-no">rejected</span>' : '<span class="tag t-draft">draft</span>';
    el.innerHTML = `
      <div class="head">
        <div class="rank">${idx + 1}</div>
        <div><div class="n">${esc(idea.name)} <span style="color:var(--muted);font-weight:400">· ${esc(idea.price)}</span></div><div class="who">${esc(idea.who)}</div></div>
        <div class="ev">${st}<span class="tag t-ev" title="demand threads matching this idea">${idea.matched} demand threads</span><span class="tag t-ev">${idea.recent} in last 30 days</span></div>
      </div>
      <div class="body">
        <div class="grid">
          <div>
            <label>Service name</label><input type="text" data-f="name" value="${esc(idea.name)}">
            <label>What you deliver</label><textarea data-f="offer" style="min-height:70px">${esc(idea.offer)}</textarea>
            <label>Price</label><input type="text" data-f="price" value="${esc(idea.price)}">
            <label>Target subreddits (tick the ones you approve)</label>
            <div class="chips">${Array.from(new Set([...idea.targets, ...(idea.allTargets || [])])).map((s) => `<span class="chip"><input type="checkbox" data-sub="${esc(s)}" ${idea.targets.includes(s) ? "checked" : ""}>r/${esc(s)}</span>`).join("") || '<span style="color:var(--muted)">none found yet</span>'}
              <span class="chip"><input type="text" data-addsub placeholder="add r/…" style="width:110px;padding:1px 4px;border:0"></span></div>
            <label>Your notes</label><textarea data-f="notes" style="min-height:50px" placeholder="why yes / why no, what to change…">${esc(idea.notes || "")}</textarea>
          </div>
          <div>
            <label>Post title (editable)</label><input type="text" data-f="title" value="${esc(idea.title)}">
            <label>Post body (editable)</label><textarea data-f="body">${esc(idea.body)}</textarea>
            <label>Threads you could answer with this offer now</label>
            <div class="opps">${idea.opps.length ? idea.opps.map((o) => `<div class="o"><b>${o.opp}</b><a href="${esc(o.url)}" target="_blank">${esc(o.title)}</a></div>`).join("") : '<span style="color:var(--muted)">none in scraped data yet</span>'}</div>
            ${campaign.status === "live" && idea.status === "approved" ? `<label>Campaign checklist</label><div class="check">
              ${[["posted", `Posted the offer in ${idea.targets.map((s) => "r/" + s).join(", ") || "your target subreddits"} (one subreddit per 7 days on r/forhire)`], ["replied", "Replied to the opportunity threads above"], ["dms", "Answered every DM within 2 hours"], ["tracked", "Logged replies and DMs in Notes after 48h"]].map(([k, t]) => `<label><input type="checkbox" data-ck="${k}" ${idea.checklist && idea.checklist[k] ? "checked" : ""}>${t}</label>`).join("")}</div>` : ""}
          </div>
        </div>
        <div class="row">
          <button class="btn" data-act="copy">Copy post</button>
          <button class="btn" data-act="save">Save edits</button><span class="saved" data-saved></span>
          <span class="sp"></span>
          <button class="btn no" data-act="reject">Reject</button>
          <button class="btn ok" data-act="approve">${idea.status === "approved" ? "Approved ✓" : "Approve"}</button>
        </div>
      </div>`;
    el.querySelector(".head").addEventListener("click", () => { openSet.has(idea.key) ? openSet.delete(idea.key) : openSet.add(idea.key); render(); });
    const readForm = () => {
      el.querySelectorAll("[data-f]").forEach((inp) => { idea[inp.dataset.f] = inp.value; });
      idea.targets = Array.from(el.querySelectorAll("input[data-sub]:checked")).map((c) => c.dataset.sub);
    };
    el.querySelector("[data-addsub]").addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return; const s = e.target.value.trim().replace(/^r\//, ""); if (!s) return;
      readForm(); idea.allTargets = Array.from(new Set([...(idea.allTargets || []), ...idea.targets, s])); idea.targets = Array.from(new Set([...idea.targets, s])); await save(); render();
    });
    el.querySelectorAll("[data-ck]").forEach((c) => c.addEventListener("change", async () => { idea.checklist = idea.checklist || {}; idea.checklist[c.dataset.ck] = c.checked; await save(); }));
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      readForm();
      const act = b.dataset.act;
      if (act === "copy") { await navigator.clipboard.writeText(idea.title + "\n\n" + idea.body); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy post"), 1500); return; }
      if (act === "approve") idea.status = "approved";
      if (act === "reject") idea.status = "rejected";
      await save();
      if (act === "save") { el.querySelector("[data-saved]").textContent = "Saved."; setTimeout(render, 600); } else render();
    }));
    list.appendChild(el);
  });
}

$("dash").addEventListener("click", () => { location.href = "dashboard.html"; });
$("regen").addEventListener("click", () => load(true));
$("start").addEventListener("click", async () => {
  if (campaign.status === "live") { if (!confirm("Stop the campaign? Ideas and edits are kept.")) return; campaign.status = "draft"; campaign.startedAt = null; }
  else { const n = campaign.ideas.filter((i) => i.status === "approved").length; if (!confirm(`Start the campaign with ${n} approved idea${n === 1 ? "" : "s"}? This only unlocks the checklists; nothing is posted for you.`)) return; campaign.status = "live"; campaign.startedAt = Date.now(); campaign.ideas.filter((i) => i.status === "approved").forEach((i) => openSet.add(i.key)); }
  await save(); render();
});
$("export").addEventListener("click", () => {
  const approved = campaign.ideas.filter((i) => i.status === "approved");
  const text = approved.map((i, n) => `${n + 1}. ${i.name} — ${i.price}\nFor: ${i.who}\nDeliver: ${i.offer}\nTarget: ${i.targets.map((s) => "r/" + s).join(", ")}\n\nTITLE: ${i.title}\n\n${i.body}\n\nNotes: ${i.notes || ""}\n${"-".repeat(60)}\n`).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text || "No approved ideas yet."], { type: "text/plain" })); a.download = `campaign-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
});
load();
