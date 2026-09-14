// Co-founder hunt page: one post at a time, a 3-line public reply to copy,
// a long DM to send, then next. Nobody is ever shown twice.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

let queue = [];        // local working copy, so a skip advances instantly
let cur = null;        // the post on screen
let variant = 0;
let profile = {};
let lastActed = null;

function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.round(m / 60) + "h ago";
  return Math.round(m / 1440) + "d ago";
}

function render() {
  const has = !!cur;
  $("wrap").hidden = !has;
  $("empty").hidden = has;
  if (!has) return;
  const p = cur;
  $("title").textContent = p.title;
  $("title").href = p.permalink;
  const tags = [
    `<span class="tag ${p.role === "technical" ? "tech" : ""}">${p.role} co-founder</span>`,
    p.hasBudget ? '<span class="tag money">has money</span>' : "",
    p.equityOnly ? '<span class="tag equity">equity only</span>' : "",
    p.stage !== "unknown" ? `<span class="tag">${p.stage}</span>` : "",
  ].filter(Boolean).join(" ");
  $("meta").innerHTML = `r/${p.sub} · u/${p.author} · ${ago(p.created || p.firstSeen)} · ${p.comments} comments · fit ${p.score} ${tags}`;
  $("body").textContent = p.body || "(no body text)";
  $("short").value = huntShortReply(p, profile, variant);
  $("dm").value = huntDM(p, profile);
  $("repliedMark").hidden = !p.repliedAt;
  $("dmMark").hidden = !p.dmAt;
}

function next() {
  queue.shift();
  cur = queue[0] || null;
  variant = 0;
  render();
}

async function refresh(keepCurrent = true) {
  const r = await send({ type: "hunt-queue", limit: 60 });
  if (!r) return;
  $("sQueue").textContent = r.total;
  $("sToday").textContent = r.contactedToday;
  $("sEver").textContent = r.contactedTotal;
  $("sBlocked").textContent = r.blocked;
  $("sPoll").textContent = r.lastError ? "last check failed: " + r.lastError
    : r.lastPoll ? "checked " + ago(r.lastPoll) + " · " + r.found + " found so far" : "never checked";
  $("sPoll").style.color = r.lastError ? "#ff8a65" : "";
  $("hint").hidden = !(r.lastError || (!r.total && r.lastPoll));
  $("toggle").textContent = r.on ? "Watching · stop" : "Start watching";
  $("toggle").className = r.on ? "" : "primary";

  const keepId = keepCurrent && cur ? cur.id : null;
  const fresh = r.queue;
  if (keepId && fresh.some((x) => x.id === keepId)) {
    // keep the card you are working on at the front
    queue = [fresh.find((x) => x.id === keepId), ...fresh.filter((x) => x.id !== keepId)];
  } else {
    queue = fresh;
  }
  const prevId = cur && cur.id;
  cur = queue[0] || null;
  if (!cur || cur.id !== prevId) variant = 0;
  render();
}

async function act(action) {
  if (!cur) return;
  lastActed = cur.id;
  await send({ type: "hunt-act", id: cur.id, action });
  if (action === "replied") { cur.repliedAt = Date.now(); render(); refresh(); return; }
  next();
  refresh();
}

async function copy(el, btn) {
  await navigator.clipboard.writeText(el.value);
  const was = btn.textContent;
  btn.textContent = "Copied ✓";
  setTimeout(() => { btn.textContent = was; }, 1200);
}

$("copyShort").onclick = () => copy($("short"), $("copyShort"));
$("copyDm").onclick = () => copy($("dm"), $("copyDm"));
$("variant").onclick = () => { variant += 1; $("short").value = huntShortReply(cur, profile, variant); };
$("openPost").onclick = () => cur && window.open(cur.permalink, "_blank");
$("openDm").onclick = () => cur && window.open(huntComposeUrl(cur, $("dm").value), "_blank");
$("didReply").onclick = () => act("replied");
$("didDm").onclick = () => act("dm");
$("skip").onclick = () => act("skip");
$("bad").onclick = () => act("not_relevant");
$("undo").onclick = async () => { if (lastActed) { await send({ type: "hunt-act", id: lastActed, action: "undo" }); lastActed = null; await refresh(false); } };
$("now").onclick = async () => {
  $("now").textContent = "Checking…"; $("now").disabled = true;
  try {
    // the first check opens a pinned Reddit tab, so give it room, but never hang
    const r = await Promise.race([send({ type: "hunt-poll" }), new Promise((ok) => setTimeout(() => ok({ ok: false, error: "no answer in 45s — reload the pinned old.reddit.com tab" }), 45000))]);
    if (r && r.error) $("sPoll").textContent = "last check failed: " + r.error;
  } finally { $("now").textContent = "Check now"; $("now").disabled = false; refresh(); }
};
$("toggle").onclick = async () => {
  const on = $("toggle").textContent.startsWith("Start");
  await send({ type: "hunt-on", on });
  refresh();
};

document.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test((e.target.tagName || ""))) return;
  if (e.key === "1") $("didReply").click();
  if (e.key === "2") $("didDm").click();
  if (e.key === "s") $("skip").click();
  if (e.key === "x") $("bad").click();
});

(async () => {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  profile = config.profile || {};
  await refresh(false);
  setInterval(() => refresh(true), 20000);
})();
