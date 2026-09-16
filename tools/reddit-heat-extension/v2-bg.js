// v2-bg.js — the Growth Board's engine. Loaded into the same service worker
// as v1, so it shares the API key, the spend ledger and the Reddit fetcher
// and changes nothing that v1 depends on.

const V2_STORE = "v2";
const V2_EMPTY = { plan: [], drafts: {}, posts: {}, leads: {}, queue: {}, targets: {}, settings: {}, pool: [], made: [], roomOffers: {}, briefs: {}, mine: {}, boosts: {}, answered: 0, lastPlan: 0, lastLeads: 0, lastScan: 0, lastMine: 0 };

async function v2Get() {
  const { v2 = {} } = await chrome.storage.local.get([V2_STORE]);
  return { ...V2_EMPTY, ...v2 };
}
async function v2Set(patch) {
  const st = await v2Get();
  const next = { ...st, ...patch };
  await chrome.storage.local.set({ [V2_STORE]: next });
  return next;
}
function v2Settings(st) {
  return { auto: false, campaign: "", perDay: 3, subCoolDays: 14, magnetEvery: 2, kinds: "all", days: 30, subs: [], offers: [], types: [], commentsPerPost: 5, dailyBudget: 7, ...(st.settings || {}) };
}
// Offers written in the studio live in storage, not in the shipped list, so
// they are merged back onto V2 before anything resolves an offer key. The
// same pass applies whatever the rules scraper learned about each room.
function v2Apply(st) {
  V2.POOL = Array.isArray(st.pool) ? st.pool : [];
  for (const [sub, info] of Object.entries(st.targets || {})) {
    if (!info || !info.promo) continue;
    const t = V2.TARGETS.find((x) => x.sub === sub);
    if (t && t.promo !== info.promo) { t.promo = info.promo; t.promoWhy = info.promoWhy || ""; }
  }
}
const v2Key = (r) => r.sub + "|" + r.typeKey + "|" + r.offerKey;

// ------------------------------------------------------------------ plan
async function v2Plan(opts = {}) {
  const st = await v2Get();
  v2Apply(st);
  const s = { ...v2Settings(st), ...opts };
  const history = Object.values(st.posts || {}).map((p) => ({ sub: p.sub, at: p.at || 0 }));
  const built = V2.plan({ days: s.days, perDay: s.perDay, subCoolDays: s.subCoolDays, magnetEvery: s.magnetEvery, kinds: s.kinds, subs: s.subs, offers: s.offers, types: s.types, commentsPerPost: s.commentsPerPost, history, start: opts.start || Date.now() });
  if (built.error) return { ok: false, error: built.error };
  // a row already posted keeps its place; a draft already written is carried
  // over to the row that asks for the same thing, so replanning never throws
  // away work you have paid for
  const posted = (st.plan || []).filter((r) => r.state === "posted");
  const drafts = {};
  for (const r of built.rows) {
    const old = (st.plan || []).find((o) => o.sub && v2Key(o) === v2Key(r) && st.drafts[o.n]);
    if (old) { drafts[r.n] = st.drafts[old.n]; r.state = "drafted"; }
  }
  const rows = built.rows;
  for (const p of posted) { const hit = rows.find((r) => r.sub === p.sub && r.typeKey === p.typeKey); if (hit) Object.assign(hit, { state: "posted", url: p.url, postId: p.postId, postedAt: p.postedAt }); }
  await v2Set({ plan: rows, drafts, settings: s, lastPlan: Date.now() });
  return { ok: true, rows, magnets: built.magnets, values: built.values, rooms: built.rooms, skipped: built.skipped, groups: built.groups, perDay: built.perDay, comments: built.comments };
}

async function v2Board() {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ledger = v2Ledger(st);
  const rows = (st.plan || []).map((r) => {
    const b = (st.briefs || {})[r.sub];
    const used = ledger[r.offerKey + "|" + r.sub];
    return {
      ...r,
      draft: st.drafts[r.n] ? { title: st.drafts[r.n].title, words: String(st.drafts[r.n].body || "").split(/\s+/).length, issues: st.drafts[r.n].issues || [], risk: st.drafts[r.n].risk || "" } : null,
      read: !!b,
      blocked: !!(b && b.verdict && b.verdict.blocked),
      verdict: b && b.verdict ? b.verdict.headline : "",
      repeat: used ? (used.removed ? "removed here before" : "this offer has already run here") : "",
    };
  });
  const due = rows.find((r) => r.sub && r.state !== "posted" && r.at <= today.getTime() + 86400000);
  const leads = Object.values(st.leads || {});
  const postedRows = rows.filter((r) => r.state === "posted");
  return {
    ok: true, rows, settings: s,
    due: due || null,
    counts: {
      planned: rows.filter((r) => r.state === "planned").length,
      drafted: rows.filter((r) => r.state === "drafted").length,
      posted: postedRows.length,
      leads: leads.length,
      newLeads: leads.filter((l) => l.state === "new").length,
    },
    campaign: (() => { const c = V2.campaign(s.campaign); return c ? { key: c.key, name: c.name, niche: c.niche, shape: V2.campaignShape(c) } : null; })(),
    // the real number of comments the account left in the last month beats our
    // own tally, which only ever sees answers written in here
    blocked: rows.filter((r) => r.blocked).length,
    unread: rows.filter((r) => r.sub && !r.read).length,
    repeats: rows.filter((r) => r.repeat).length,
    ratio: V2.ratio(Object.keys(st.mine || {}).length || postedRows.length, Math.max(st.myComments || 0, st.answered || 0)),
    results: v2Results(st),
    lastLeads: st.lastLeads || 0, lastScan: st.lastScan || 0,
    targets: st.targets || {},
  };
}

// Three posts a day only pays for itself if you can see which of the three
// worked. Everything is grouped twice — by the kind of room and by the shape
// of the post — so the winner is a fact rather than a feeling.
function v2Results(st) {
  const byGroup = {}, byShape = {}, byOffer = {};
  const bump = (bag, key, patch) => {
    if (!key) return;
    const b = (bag[key] = bag[key] || { key, posts: 0, leads: 0, hot: 0, replied: 0, won: 0 });
    for (const k of Object.keys(patch)) b[k] += patch[k];
  };
  const leads = Object.values(st.leads || {});
  for (const p of Object.values(st.posts || {})) {
    const mine = leads.filter((l) => l.postN === p.n);
    const patch = { posts: 1, leads: mine.length, hot: mine.filter((l) => l.tier >= 2).length,
      replied: mine.filter((l) => ["replied", "won"].includes(l.state)).length, won: mine.filter((l) => l.state === "won").length };
    const room = V2.TARGETS.find((t) => t.sub === p.sub);
    bump(byGroup, (room && room.kind) || "biz", patch);
    bump(byShape, p.typeKey, patch);
    bump(byOffer, p.offerKey, patch);
  }
  const rank = (bag, label) => Object.values(bag).sort((a, b) => (b.hot - a.hot) || (b.leads - a.leads)).map((r) => ({ ...r, name: label(r.key), per: r.posts ? Math.round((r.leads / r.posts) * 10) / 10 : 0 }));
  return {
    groups: rank(byGroup, (k) => (V2.KINDS.find((x) => x.key === k) || {}).name || k),
    shapes: rank(byShape, (k) => V2.postType(k).name),
    offers: rank(byOffer, (k) => V2.offer(k).name),
  };
}

// ----------------------------------------------------------------- write
async function v2Ai(system, user, schema, maxTokens, label) {
  const key = await huntAiKey();
  if (!key) return { ok: false, error: "no API key saved — put it in Your details", noKey: true };
  const spent = await spendGet();
  if (spent.cents >= spent.budget) return { ok: false, overBudget: true, error: `today's AI budget is used up (${spent.cents}¢ of ${spent.budget}¢)` };
  const model = await aiModel();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  let r, j;
  try {
    r = await fetch(AI_URL, { method: "POST", signal: ctl.signal, headers: aiHeaders(key, model), body: JSON.stringify(aiBody(model, system, user, schema, maxTokens)) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: /abort/i.test(String(e)) ? "the API took more than two minutes" : "could not reach api.anthropic.com: " + String(e.message || e) };
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || ("HTTP " + r.status);
    return { ok: false, error: r.status === 401 ? "the API key was rejected" : r.status === 429 ? "rate limited, try again in a minute" : msg };
  }
  if (j.stop_reason === "refusal") return { ok: false, error: "the model declined this one" };
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: "the model returned something that was not JSON" }; }
  const u = j.usage || {};
  const cents = aiCents(model, u);
  await spendAdd(cents, { kind: label, who: "", what: label, model, in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0 });
  return { ok: true, parsed, cents, model };
}

async function v2Draft(n, force) {
  const st = await v2Get();
  v2Apply(st);
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row || !row.sub) return { ok: false, error: "that day is not on the plan" };
  if (st.drafts[n] && !force) return { ok: true, draft: st.drafts[n], cached: true };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  const target = V2.TARGETS.find((t) => t.sub === row.sub) || { sub: row.sub, kind: row.kind, promo: row.promo, note: "" };
  const system = V2.postSystem(profile);
  let extra = typeof force === "string" && force !== "true" ? force : "";
  let out = null, issues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shape = ((st.briefs || {})[row.sub] || {}).shape || null;
    const res = await v2Ai(system, V2.postUser(target, row.offerKey, row.typeKey, profile, extra, { shape }), V2.POST_SCHEMA, 3000, "board post");
    if (!res.ok) return res;
    issues = V2.postChecks(res.parsed, target, row.typeKey);
    out = { ...res.parsed, at: Date.now(), model: res.model, cents: res.cents, issues };
    if (!issues.length) break;
    extra = "Your last draft was rejected for these reasons, fix every one of them: " + issues.join("; ");
  }
  st.drafts[n] = out;
  row.state = row.state === "posted" ? "posted" : "drafted";
  await v2Set({ drafts: st.drafts, plan: st.plan });
  return { ok: true, draft: out, issues };
}

async function v2DraftSave(n, patch) {
  const st = await v2Get();
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row) return { ok: false, error: "no such day" };
  const d = { ...(st.drafts[n] || {}), ...patch, editedAt: Date.now() };
  const target = V2.TARGETS.find((t) => t.sub === row.sub) || { sub: row.sub };
  d.issues = V2.postChecks(d, target, row.typeKey);
  st.drafts[n] = d;
  if (row.state === "planned") row.state = "drafted";
  await v2Set({ drafts: st.drafts, plan: st.plan });
  return { ok: true, draft: d };
}

// ------------------------------------------------------------- campaigns
// Picking a campaign is the single act that narrows the board: it sets the
// rooms, the offers, the searches and the cadence in one move, and everything
// downstream — the calendar, the scan, the boost shortlist — follows it.
async function v2CampaignSet(key) {
  const st = await v2Get();
  if (!key) {
    await v2Set({ settings: { ...v2Settings(st), campaign: "", subs: [], offers: [] } });
    return { ok: true, campaign: null, note: "back to all 191 rooms" };
  }
  const c = V2.campaign(key);
  if (!c) return { ok: false, error: "no campaign called " + key };
  const shape = V2.campaignShape(c);
  const rooms = V2.campaignRooms(c).filter(V2.postable).map((t) => t.sub);
  await v2Set({ settings: { ...v2Settings(st), campaign: key, subs: rooms, offers: c.offers.slice(), perDay: shape.perDay, subCoolDays: shape.subCoolDays } });
  return { ok: true, campaign: c, shape, rooms: rooms.length, note: shape.note };
}
async function v2Campaigns() {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  return {
    ok: true, active: s.campaign || "",
    list: V2.CAMPAIGNS.map((c) => {
      const shape = V2.campaignShape(c);
      const checked = st.targets || {};
      const members = V2.campaignRooms(c).reduce((n, t) => n + ((checked[t.sub] && checked[t.sub].members) || 0), 0);
      const online = V2.campaignRooms(c).reduce((n, t) => n + ((checked[t.sub] && checked[t.sub].online) || 0), 0);
      return { key: c.key, name: c.name, niche: c.niche, why: c.why, subs: c.subs, offers: c.offers, queries: c.queries, shape, members, online, problems: V2.campaignCheck(c) };
    }),
  };
}

// ------------------------------------------------------ every post I make
// Not just the ones the board sent. Reddit publishes everything an account
// has posted, so the board reads the lot: what it planned, what was posted by
// hand, and what was posted long before any of this existed. Without that the
// boost shortlist would only ever see half the evidence.
async function v2TrackMine(pages) {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const user = String((config.profile || {}).redditUser || "").replace(/^\/?u\//, "").trim();
  if (!user) return { ok: false, error: "put your Reddit username in Your details first — the board cannot find your posts without it" };
  const st = await v2Get();
  const mine = { ...(st.mine || {}) };
  const leads = Object.values(st.leads || {});
  const boardByPostId = {};
  for (const p of Object.values(st.posts || {})) if (p.postId) boardByPostId[p.postId] = p;

  let after = "", read = 0, added = 0;
  for (let page = 0; page < Math.max(1, Math.min(10, pages || 5)); page += 1) {
    let j = null;
    try { j = await huntFetch(`https://old.reddit.com/user/${encodeURIComponent(user)}/submitted.json?limit=100&sort=new&raw_json=1${after ? "&after=" + after : ""}`); } catch (e) { break; }
    const kids = ((j && j.data && j.data.children) || []);
    if (!kids.length) break;
    for (const c of kids) {
      const d = c.data || {};
      if (!d.id) continue;
      read += 1;
      const board = boardByPostId[d.id] || null;
      const mineLeads = board ? leads.filter((l) => l.postN === board.n) : [];
      const was = mine[d.id] || {};
      if (!was.id) added += 1;
      mine[d.id] = {
        id: d.id, sub: d.subreddit || "", title: String(d.title || "").slice(0, 300),
        permalink: "https://www.reddit.com" + String(d.permalink || ""),
        created: (d.created_utc || 0) * 1000, score: d.score || 0, comments: d.num_comments || 0,
        removed: !!d.removed_by_category, self: !!d.is_self,
        source: board ? "board" : "outside",
        n: board ? board.n : 0, typeKey: board ? board.typeKey : "", offerKey: board ? board.offerKey : "",
        magnet: board ? !!(V2.postType(board.typeKey) || {}).magnet : false,
        hot: mineLeads.filter((l) => l.tier >= 2).length,
        // remember how many comments it had when a boost began, so the money
        // is judged on what it actually bought
        boostAt: was.boostAt || 0, commentsAtStart: was.commentsAtStart || 0,
        seen: Date.now(),
      };
    }
    after = (j.data && j.data.after) || "";
    if (!after) break;
    await new Promise((r) => setTimeout(r, 900));
  }
  // the real comment count, so the ratio stops relying on our own tally
  let myComments = st.myComments || 0;
  try {
    const cj = await huntFetch(`https://old.reddit.com/user/${encodeURIComponent(user)}/comments.json?limit=100&sort=new&raw_json=1`);
    const kids = ((cj && cj.data && cj.data.children) || []);
    const cutoff = Date.now() - 30 * 86400000;
    myComments = kids.filter((c) => ((c.data || {}).created_utc || 0) * 1000 >= cutoff).length;
  } catch (_) { /* keep the old number */ }
  await v2Set({ mine, lastMine: Date.now(), myComments });
  return { ok: true, read, added, total: Object.keys(mine).length, comments30: myComments, user };
}

async function v2MineList(opts = {}) {
  const st = await v2Get();
  v2Apply(st);
  const now = Date.now();
  let rows = Object.values(st.mine || {}).map((p) => ({ ...p, boost: V2.boostScore(p, now), running: !!(st.boosts || {})[p.id] }));
  if (opts.sub) rows = rows.filter((r) => r.sub === opts.sub);
  if (opts.source && opts.source !== "all") rows = rows.filter((r) => r.source === opts.source);
  const sort = opts.sort || "new";
  if (sort === "boost") rows.sort((a, b) => b.boost.score - a.boost.score);
  else if (sort === "comments") rows.sort((a, b) => b.comments - a.comments);
  else rows.sort((a, b) => b.created - a.created);
  const all = Object.values(st.mine || {});
  return {
    ok: true, rows: rows.slice(0, opts.limit || 200), lastMine: st.lastMine || 0,
    counts: {
      total: all.length, board: all.filter((p) => p.source === "board").length, outside: all.filter((p) => p.source === "outside").length,
      comments: all.reduce((n, p) => n + (p.comments || 0), 0),
      removed: all.filter((p) => p.removed).length,
      shortlist: all.filter((p) => V2.boostScore(p, now).verdict === "boost").length,
    },
    subs: Array.from(new Set(all.map((p) => p.sub))).sort(),
    comments30: st.myComments || 0,
  };
}

// --------------------------------------------------------------- boosting
// Reddit's ad account is not readable from here, so spend is typed in and
// comments are counted for you. That is enough for the only number that
// matters: what a comment cost.
async function v2BoostAdd(id, daily, days) {
  const st = await v2Get();
  const p = (st.mine || {})[id];
  if (!p) return { ok: false, error: "that post is not in the tracker — press Read my posts first" };
  const plan = V2.boostPlan(daily || v2Settings(st).dailyBudget, days, p);
  const boosts = { ...(st.boosts || {}) };
  boosts[id] = { id, sub: p.sub, title: p.title, permalink: p.permalink, startedAt: Date.now(),
    daily: plan.daily, days: plan.days, budget: plan.total, spent: 0, commentsAtStart: p.comments || 0, state: "running" };
  const mine = { ...(st.mine || {}) };
  mine[id] = { ...p, boostAt: Date.now(), commentsAtStart: p.comments || 0 };
  await v2Set({ boosts, mine });
  return { ok: true, boost: boosts[id], plan };
}
async function v2BoostSpend(id, spent) {
  const st = await v2Get();
  const b = (st.boosts || {})[id];
  if (!b) return { ok: false, error: "no boost on that post" };
  b.spent = Math.max(0, Number(spent) || 0);
  b.updatedAt = Date.now();
  await v2Set({ boosts: st.boosts });
  return { ok: true, boost: b };
}
async function v2BoostStop(id, why) {
  const st = await v2Get();
  const b = (st.boosts || {})[id];
  if (!b) return { ok: false };
  b.state = "stopped"; b.stoppedAt = Date.now(); b.stopWhy = why || "";
  await v2Set({ boosts: st.boosts });
  return { ok: true };
}
async function v2BoostList() {
  const st = await v2Get();
  v2Apply(st);
  const now = Date.now();
  const mine = st.mine || {};
  const running = Object.values(st.boosts || {}).map((b) => {
    const p = mine[b.id] || {};
    const cost = V2.boostCost({ ...b, commentsNow: p.comments || b.commentsAtStart });
    return { ...b, commentsNow: p.comments || 0, cost };
  }).sort((a, b) => (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) || b.startedAt - a.startedAt);
  const shortlist = Object.values(mine)
    .map((p) => ({ ...p, boost: V2.boostScore(p, now) }))
    .filter((p) => !(st.boosts || {})[p.id] && ["boost", "watch"].includes(p.boost.verdict))
    .sort((a, b) => b.boost.score - a.boost.score)
    .slice(0, 12);
  const s = v2Settings(st);
  const spent = running.reduce((n, b) => n + (b.spent || 0), 0);
  const got = running.reduce((n, b) => n + b.cost.got, 0);
  return { ok: true, shortlist, running, dailyBudget: s.dailyBudget, plan: V2.boostPlan(s.dailyBudget, 7, shortlist[0] || null),
    overall: { spent, got, per: got ? Math.round((spent / got) * 100) / 100 : 0 } };
}

// ------------------------------------------------------- the offer studio
// Type what you do and what you can prove; get ten offers back, each on a
// different angle, each gated by the same rules the shipped ten obey.
async function v2OfferMake(brief) {
  if (!String(brief || "").trim()) return { ok: false, error: "write a line or two about what you do first" };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  const res = await v2Ai(V2.offerSystem(profile), V2.offerUser(brief, profile), V2.OFFER_SCHEMA, 4000, "ten offers");
  if (!res.ok) return res;
  const made = (res.parsed.offers || []).slice(0, 10).map((d, i) => {
    const o = V2.offerFromDraft(d, i);
    o.issues = V2.offerChecks(o);
    return o;
  });
  if (!made.length) return { ok: false, error: "the model returned no offers" };
  const st = await v2Get();
  await v2Set({ made, madeBrief: String(brief).slice(0, 4000), madeAt: Date.now() });
  return { ok: true, made, cents: res.cents, clean: made.filter((o) => !o.issues.length).length };
}

// Five offers written for one room, kept per room so the same five come back
// instantly when you open that day again.
async function v2RoomOffers(sub, force, extra) {
  const st = await v2Get();
  v2Apply(st);
  const target = V2.TARGETS.find((t) => t.sub === sub);
  if (!target) return { ok: false, error: "r/" + sub + " is not in the room list" };
  const cached = (st.roomOffers || {})[sub];
  if (cached && !force && !extra) return { ok: true, ...cached, cached: true };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  const camp = V2.campaign(v2Settings(st).campaign);
  const checked = (st.targets || {})[sub] || {};
  const res = await v2Ai(
    V2.roomOfferSystem(profile),
    V2.roomOfferUser(target, camp, profile, { members: checked.members, online: checked.online, rules: checked.rules, extra }),
    V2.ROOM_OFFER_SCHEMA, 3500, "five offers for r/" + sub);
  if (!res.ok) return res;
  const offers = (res.parsed.offers || []).slice(0, 5).map((d, i) => {
    const o = V2.offerFromDraft(d, i);
    o.key = "room_" + sub + "_" + Date.now().toString(36) + "_" + i;
    o.room = sub;
    o.issues = V2.offerChecks(o);
    return o;
  });
  if (!offers.length) return { ok: false, error: "the model returned no offers" };
  const spread = V2.offerSpread(offers);
  const roomOffers = { ...(st.roomOffers || {}), [sub]: { offers, read: String(res.parsed.room_read || ""), at: Date.now(), spread } };
  await v2Set({ roomOffers });
  return { ok: true, offers, read: roomOffers[sub].read, spread, cents: res.cents };
}

// Make one offer stronger. The note is the operator's: "make it paid", "aim
// it higher", "this reads like every other free audit".
async function v2OfferImprove(key, note) {
  const st = await v2Get();
  v2Apply(st);
  const found = v2FindOffer(st, key);
  if (!found) return { ok: false, error: "cannot find that offer" };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  const res = await v2Ai(V2.improveSystem(profile), V2.improveUser(found.offer, note, found.offer.room || "", profile), V2.IMPROVE_SCHEMA, 2000, "improve an offer");
  if (!res.ok) return res;
  const better = V2.offerFromDraft(res.parsed.offer || {}, 0);
  better.key = found.offer.key;                 // it replaces the original in place
  better.room = found.offer.room || "";
  better.improvedFrom = { name: found.offer.name, posture: found.offer.posture, gift: found.offer.gift, ask: found.offer.ask, risk: found.offer.risk };
  better.changed = String(res.parsed.changed || "");
  better.weakness = String(res.parsed.weakness || "");
  better.issues = V2.offerChecks(better);
  v2ReplaceOffer(st, found, better);
  await v2Set({ pool: st.pool, made: st.made, roomOffers: st.roomOffers });
  return { ok: true, offer: better, was: better.improvedFrom, cents: res.cents };
}
// An offer can be sitting in three places at once; find it wherever it is.
function v2FindOffer(st, key) {
  const inPool = (st.pool || []).findIndex((o) => o.key === key);
  if (inPool >= 0) return { where: "pool", i: inPool, offer: st.pool[inPool] };
  const inMade = (st.made || []).findIndex((o) => o.key === key);
  if (inMade >= 0) return { where: "made", i: inMade, offer: st.made[inMade] };
  for (const [sub, bag] of Object.entries(st.roomOffers || {})) {
    const i = (bag.offers || []).findIndex((o) => o.key === key);
    if (i >= 0) return { where: "room", sub, i, offer: bag.offers[i] };
  }
  const shipped = V2.OFFERS.find((o) => o.key === key);
  return shipped ? { where: "shipped", offer: { ...shipped } } : null;
}
function v2ReplaceOffer(st, found, next) {
  if (found.where === "pool") st.pool[found.i] = next;
  else if (found.where === "made") st.made[found.i] = next;
  else if (found.where === "room") st.roomOffers[found.sub].offers[found.i] = next;
  else {
    // a shipped offer is never edited in place; the better one joins the pool
    next.key = "made_" + Date.now().toString(36);
    st.pool = [...(st.pool || []), next];
  }
}

// Pin one offer to one day on the calendar. The draft for that day is thrown
// away, because it was written around the offer that is being replaced.
async function v2RowOffer(n, key) {
  const st = await v2Get();
  v2Apply(st);
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row) return { ok: false, error: "no such day" };
  const found = v2FindOffer(st, key);
  if (!found) return { ok: false, error: "cannot find that offer" };
  // it has to live somewhere the calendar can resolve it from
  if (!(st.pool || []).some((o) => o.key === key) && found.where !== "shipped") {
    st.pool = [...(st.pool || []), { ...found.offer, issues: undefined }];
  }
  row.offerKey = key;
  row.offerName = found.offer.name;
  delete st.drafts[row.n];
  if (row.state === "drafted") row.state = "planned";
  await v2Set({ plan: st.plan, drafts: st.drafts, pool: st.pool });
  return { ok: true, row, offer: found.offer };
}

async function v2OfferKeep(key) {
  const st = await v2Get();
  const o = (st.made || []).find((x) => x.key === key);
  if (!o) return { ok: false, error: "that offer is not in the last batch" };
  if ((st.pool || []).some((x) => x.key === key)) return { ok: true, already: true };
  const pool = [...(st.pool || []), { ...o, issues: undefined }];
  await v2Set({ pool });
  return { ok: true, pool: pool.length };
}
async function v2OfferForget(key) {
  const st = await v2Get();
  const pool = (st.pool || []).filter((x) => x.key !== key);
  const settings = v2Settings(st);
  settings.offers = (settings.offers || []).filter((k) => k !== key);
  await v2Set({ pool, settings });
  return { ok: true, pool: pool.length };
}
// Which offers the calendar is allowed to use. An empty list means all of them.
async function v2OfferPick(keys) {
  const st = await v2Get();
  await v2Set({ settings: { ...v2Settings(st), offers: Array.isArray(keys) ? keys : [] } });
  return { ok: true };
}
async function v2Offers() {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  return { ok: true, shipped: V2.OFFERS, pool: st.pool || [], made: st.made || [], brief: st.madeBrief || "",
    picked: s.offers || [], angles: V2.OFFER_ANGLES, postures: V2.POSTURES,
    spread: V2.offerSpread((st.made || []).length ? st.made : V2.OFFERS) };
}

// ------------------------------------------------------------- posting it
// The board fills Reddit's own submit form and stops. One post a day, in one
// room, typed into the real composer — that is what a human account looks
// like, and it is the difference between a board that runs for a year and an
// account that is gone in a fortnight.
async function v2Open(n, force) {
  const st = await v2Get();
  const row = (st.plan || []).find((r) => r.n === Number(n));
  const draft = st.drafts[n];
  if (!row || !draft) return { ok: false, error: "write the post first" };
  // a room whose own rules ban us is never opened by accident
  const brief = (st.briefs || {})[row.sub];
  if (brief && brief.verdict && brief.verdict.blocked && !force) {
    return { ok: false, blocked: true, verdict: brief.verdict, error: brief.verdict.headline + " — " + brief.verdict.reasons[0] };
  }
  await chrome.storage.local.set({ v2Pending: { n: row.n, sub: row.sub, title: draft.title, body: draft.body, first_comment: draft.first_comment || "", weekly: !!row.weekly, at: Date.now() } });
  const url = row.weekly
    ? `https://www.reddit.com/r/${encodeURIComponent(row.sub)}/`      // the weekly thread lives in the sub, find it by hand
    : `https://www.reddit.com/r/${encodeURIComponent(row.sub)}/submit/?type=TEXT`;
  const tab = await chrome.tabs.create({ url });
  return { ok: true, tabId: tab.id, weekly: !!row.weekly };
}

async function v2Pending() {
  const { v2Pending: p = null } = await chrome.storage.local.get(["v2Pending"]);
  if (!p || Date.now() - (p.at || 0) > 3600000) return null;
  return p;
}

async function v2MarkPosted(n, url) {
  const st = await v2Get();
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row) return { ok: false, error: "no such day" };
  const id = (String(url || "").match(/\/comments\/([a-z0-9]+)/i) || [])[1] || "";
  Object.assign(row, { state: "posted", url: url || "", postId: id, postedAt: Date.now() });
  st.posts[row.n] = { n: row.n, sub: row.sub, typeKey: row.typeKey, offerKey: row.offerKey, url: url || "", postId: id, at: Date.now(), title: (st.drafts[n] || {}).title || "" };
  await v2Set({ plan: st.plan, posts: st.posts });
  await chrome.storage.local.remove(["v2Pending"]);
  return { ok: true, postId: id };
}

async function v2Skip(n, why) {
  const st = await v2Get();
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row) return { ok: false };
  row.state = "skipped"; row.skippedWhy = why || "";
  await v2Set({ plan: st.plan });
  return { ok: true };
}

// ------------------------------------------------------------- the leads
// Everyone who comments on one of our posts is a lead: they read an offer,
// they raised a hand, and they did it in public. This is the whole point of
// the magnet posts, and it is the opposite of a cold DM.
async function v2LeadPoll() {
  const st = await v2Get();
  const mine = ((await chrome.storage.local.get(["config"])).config || {}).profile || {};
  const me = String(mine.redditUser || "").replace(/^u\//, "").toLowerCase();
  const posts = Object.values(st.posts || {}).filter((p) => p.postId);
  let added = 0, read = 0;
  for (const p of posts) {
    let j = null;
    try { j = await huntFetch(`https://old.reddit.com/comments/${p.postId}.json?limit=200&sort=new&raw_json=1`); } catch (_) { continue; }
    const listing = Array.isArray(j) ? j[1] : null;
    const kids = ((listing && listing.data && listing.data.children) || []);
    for (const c of kids) {
      const d = c && c.data;
      if (!d || d.kind === "more" || !d.author) continue;
      const author = String(d.author);
      if (author === "[deleted]" || /^automoderator$/i.test(author)) continue;
      if (me && author.toLowerCase() === me) continue;
      read += 1;
      const id = p.postId + "|" + author;
      const body = String(d.body || "").replace(/\s+/g, " ").trim();
      const buyer = V2.classifyBuyer(body, "", p.sub);
      if (st.leads[id]) { st.leads[id].body = body || st.leads[id].body; continue; }
      st.leads[id] = { id, author, body, at: (d.created_utc || 0) * 1000 || Date.now(), postN: p.n, sub: p.sub, offerKey: p.offerKey,
        permalink: "https://www.reddit.com" + String(d.permalink || ""), tier: buyer.tier, badge: buyer.badge || "raised hand", why: buyer.why, state: "new" };
      added += 1;
    }
  }
  await v2Set({ leads: st.leads, lastLeads: Date.now() });
  return { ok: true, added, read, posts: posts.length };
}

async function v2LeadAct(id, action, note) {
  const st = await v2Get();
  const l = st.leads[id];
  if (!l) return { ok: false };
  if (action === "delivered") { l.state = "delivered"; l.deliveredAt = Date.now(); }
  else if (action === "replied") { l.state = "replied"; l.repliedAt = Date.now(); }
  else if (action === "won") { l.state = "won"; l.wonAt = Date.now(); }
  else if (action === "drop") { l.state = "dropped"; }
  else if (action === "undo") { l.state = "new"; delete l.deliveredAt; delete l.repliedAt; delete l.wonAt; }
  if (note !== undefined) l.note = String(note || "");
  await v2Set({ leads: st.leads });
  return { ok: true, lead: l };
}

// ----------------------------------------------------- do these rooms exist
// Rather than trust the list we shipped, ask Reddit. Subscribers, whether
// the room still exists, whether it takes text posts. A wrong guess in the
// list is corrected here instead of wasting a posting day.
async function v2CheckTargets(only) {
  const st = await v2Get();
  const out = { ...(st.targets || {}) };
  const list = only && only.length ? V2.TARGETS.filter((t) => only.includes(t.sub)) : V2.TARGETS;
  let ok = 0, gone = 0, ruled = 0, i = 0;
  await chrome.storage.local.set({ v2Check: { running: true, total: list.length, done: 0, where: "", stop: false } });
  for (const t of list) {
    i += 1;
    const { v2Check: ck = {} } = await chrome.storage.local.get(["v2Check"]);
    if (ck.stop) break;
    await chrome.storage.local.set({ v2Check: { running: true, total: list.length, done: i, where: "r/" + t.sub, stop: false } });
    let about = null;
    try { about = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(t.sub)}/about.json?raw_json=1`); } catch (_) { /* below */ }
    const d = (about && about.data) || {};
    if (!d.display_name) { out[t.sub] = { ok: false, why: "not found, private or banned", at: Date.now() }; gone += 1; await new Promise((r) => setTimeout(r, 350)); continue; }
    const row = {
      ok: true, at: Date.now(),
      members: d.subscribers || 0,
      online: d.accounts_active || d.active_user_count || 0,
      type: d.submission_type || "any",
      over18: !!d.over18,
      restricted: d.subreddit_type !== "public",
      quarantined: !!d.quarantine,
      title: String(d.title || d.public_description || "").slice(0, 160),
    };
    // the room's own rules, straight from Reddit, and what they imply about
    // whether we may post an offer there at all
    try {
      const rj = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(t.sub)}/about/rules.json?raw_json=1`);
      const rules = ((rj && rj.rules) || []).map((r) => ({
        name: String(r.short_name || "").slice(0, 120),
        what: String(r.description || "").replace(/\s+/g, " ").slice(0, 600),
        kind: r.kind || "",
      }));
      if (rules.length) { row.rules = rules; ruled += 1; }
      const verdict = V2.promoFromRules(rules, d.submit_text || "", d.description || d.public_description || "");
      if (verdict) { row.promo = verdict.promo; row.promoWhy = verdict.why; }
    } catch (_) { /* some rooms hide their rules json */ }
    if (row.restricted || row.quarantined) { row.promo = "no"; row.promoWhy = row.quarantined ? "the room is quarantined" : "the room is restricted — only approved users may post"; }
    if (row.type === "link") { row.promo = "no"; row.promoWhy = "it does not take text posts"; }
    out[t.sub] = row;
    ok += 1;
    await new Promise((r) => setTimeout(r, 450));
  }
  await chrome.storage.local.set({ v2Check: { running: false, total: list.length, done: i, where: "", stop: false } });
  await v2Set({ targets: out, lastCheck: Date.now() });
  const moved = Object.values(out).filter((x) => x && x.promo).length;
  return { ok: true, checked: ok, failed: gone, ruled, moved, targets: out };
}

// Which rooms the calendar may use. An empty list means every room that
// allows a post.
async function v2Rooms(picked) {
  const st = await v2Get();
  await v2Set({ settings: { ...v2Settings(st), subs: Array.isArray(picked) ? picked : [] } });
  return { ok: true, picked: (picked || []).length };
}

// ------------------------------------------------ the pre-flight brief
// Before anything is posted: what the rules say, and what the room has
// actually let stand. Both, because they disagree more often than not.
async function v2RoomBrief(sub, force) {
  const st = await v2Get();
  v2Apply(st);
  const target = V2.TARGETS.find((t) => t.sub === sub);
  const cached = (st.briefs || {})[sub];
  if (cached && !force && Date.now() - (cached.at || 0) < 7 * 86400000) return { ok: true, ...cached, cached: true };

  const brief = { sub, at: Date.now(), rules: [], about: {}, precedent: [], rivals: [], counts: {}, errors: [] };
  const step = async (n, total, where) => chrome.storage.local.set({ v2Brief: { running: true, sub, done: n, total, where, stop: false } });
  const probes = V2.PROBE_QUERIES;
  const total = probes.length + 3;
  let i = 0;

  await step(++i, total, "what r/" + sub + " is");
  try {
    const j = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(sub)}/about.json?raw_json=1`);
    const d = (j && j.data) || {};
    brief.about = { title: String(d.title || d.public_description || "").slice(0, 200), members: d.subscribers || 0, online: d.accounts_active || d.active_user_count || 0,
      type: d.submission_type || "any", restricted: d.subreddit_type !== "public", quarantined: !!d.quarantine,
      submitText: String(d.submit_text || "").slice(0, 2000), description: String(d.description || d.public_description || "").slice(0, 4000) };
  } catch (e) { brief.errors.push("could not read what the room is"); }

  await step(++i, total, "its rules");
  try {
    const rj = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(sub)}/about/rules.json?raw_json=1`);
    brief.rules = ((rj && rj.rules) || []).map((r) => ({ name: String(r.short_name || "").slice(0, 160), what: String(r.description || "").replace(/\s+/g, " ").slice(0, 1200), kind: r.kind || "" }));
  } catch (e) { brief.errors.push("this room does not publish its rules as data"); }
  brief.rule = V2.promoFromRules(brief.rules, brief.about.submitText, brief.about.description);
  if (brief.about.restricted) brief.rule = { promo: "no", why: "the room is restricted — only approved users may post" };
  if (brief.about.type === "link") brief.rule = { promo: "no", why: "it does not take text posts" };

  // how often anything at all gets removed here
  await step(++i, total, "what is on its front page");
  const seen = {};
  const eat = (children) => {
    for (const c of children || []) {
      const d = (c && c.data) || {};
      if (!d.id || seen[d.id]) continue;
      seen[d.id] = 1;
      const hit = V2.classifyPromoPost(d, Date.now());
      if (hit) brief.precedent.push(hit);
    }
  };
  try {
    const nj = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=100&raw_json=1`);
    const kids = ((nj && nj.data && nj.data.children) || []);
    brief.counts.recent = kids.length;
    brief.counts.recentRemoved = kids.filter((c) => { const d = c.data || {}; return !!d.removed_by_category || /^\[(removed|deleted)\]$/i.test(String(d.selftext || "").trim()); }).length;
    eat(kids);
  } catch (e) { brief.errors.push("could not read its recent posts"); }

  // and every shape of promotional post anyone has tried here in a year
  for (const q of probes) {
    const { v2Brief: b = {} } = await chrome.storage.local.get(["v2Brief"]);
    if (b.stop) break;
    await step(++i, total, '"' + q + '"');
    try {
      const j = await huntFetch(`https://old.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&sort=new&t=year&limit=25&raw_json=1`);
      eat((j && j.data && j.data.children) || []);
    } catch (e) { /* one probe failing is not fatal */ }
    await new Promise((r) => setTimeout(r, 650));
  }

  brief.precedent.sort((a, b) => b.created - a.created);
  const by = (k, f) => brief.precedent.filter((p) => p.kind === k && f(p)).length;
  brief.counts = {
    ...brief.counts,
    offer: brief.precedent.filter((p) => p.kind === "offer").length,
    survivedOffer: by("offer", (p) => p.survived),
    removedOffer: by("offer", (p) => p.removed),
    case: brief.precedent.filter((p) => p.kind === "case").length,
    survivedCase: by("case", (p) => p.survived),
    removedCase: by("case", (p) => p.removed),
    ama: brief.precedent.filter((p) => p.kind === "ama").length,
    removedAll: brief.precedent.filter((p) => p.removed).length,
  };

  // who else is selling in here, and how it went for them
  const byAuthor = {};
  for (const p of brief.precedent) {
    if (!p.author || p.author === "[deleted]") continue;
    const a = (byAuthor[p.author] = byAuthor[p.author] || { author: p.author, posts: 0, removed: 0, survived: 0, service: false, best: null });
    a.posts += 1;
    if (p.removed) a.removed += 1;
    if (p.survived) a.survived += 1;
    if (p.service) a.service = true;
    if (!a.best || (p.comments || 0) > (a.best.comments || 0)) a.best = p;
  }
  brief.rivals = Object.values(byAuthor)
    .filter((a) => a.posts >= 2 || a.service)
    .sort((a, b) => (b.survived - a.survived) || (b.posts - a.posts))
    .slice(0, 12);

  brief.verdict = V2.briefVerdict({ rule: brief.rule, precedent: brief.counts });
  const briefs = { ...(st.briefs || {}), [sub]: brief };
  await chrome.storage.local.set({ v2Brief: { running: false, sub, done: i, total, where: "", stop: false } });
  await v2Set({ briefs });
  return { ok: true, ...brief };
}

// Claude reads the rule text as a person would, and must quote the sentence
// it based the answer on — a quote that is not in the rules we sent is
// rejected, so a confident paraphrase cannot pass for a rule.
async function v2RulesRead(sub, force) {
  const st = await v2Get();
  const brief = (st.briefs || {})[sub];
  if (!brief) return { ok: false, error: "read the room first" };
  if (brief.read && !force) return { ok: true, read: brief.read, cached: true };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  let extra = "", out = null, issues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await v2Ai(V2.rulesSystem(), V2.rulesUser(sub, brief.about, brief.rules, brief.precedent) + (extra ? "\n\n" + extra : ""),
      V2.RULES_SCHEMA, 1600, "read r/" + sub + "'s rules");
    if (!res.ok) return res;
    issues = V2.rulesChecks(res.parsed, brief.rules);
    out = { ...res.parsed, at: Date.now(), cents: res.cents, issues };
    if (!issues.length) break;
    extra = "Your last answer was rejected: " + issues.join("; ") + ". The quote must be copied word for word from the rules above.";
  }
  brief.read = out;
  await v2Set({ briefs: { ...(st.briefs || {}), [sub]: brief } });
  return { ok: true, read: out, issues };
}

// What survives in a room, read off the posts that are still standing there.
async function v2Shape(sub, force) {
  const st = await v2Get();
  const brief = (st.briefs || {})[sub];
  if (!brief) return { ok: false, error: "read the room first" };
  if (brief.shape && !force) return { ok: true, shape: brief.shape, cached: true };
  const survived = (brief.precedent || []).filter((p) => p.survived);
  const removed = (brief.precedent || []).filter((p) => p.removed);
  if (!survived.length && !removed.length) return { ok: false, error: "nothing has been tried here, so there is no shape to learn" };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  let extra = "", out = null, issues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await v2Ai(V2.shapeSystem(config.profile || {}), V2.shapeUser(sub, survived, removed) + (extra ? "\n\n" + extra : ""),
      V2.SHAPE_SCHEMA, 1800, "what survives in r/" + sub);
    if (!res.ok) return res;
    issues = V2.shapeChecks(res.parsed);
    out = { ...res.parsed, at: Date.now(), cents: res.cents, issues, from: survived.length, against: removed.length };
    if (!issues.length) break;
    extra = "Your last answer was rejected: " + issues.join("; ") + ". We are an outside marketing team and cannot claim to work inside this trade.";
  }
  brief.shape = out;
  await v2Set({ briefs: { ...(st.briefs || {}), [sub]: brief } });
  return { ok: true, shape: out, issues };
}

// ------------------------------------------------- reading every room at once
// One room takes about twelve seconds. Sixteen is three minutes, once, and
// after that nobody has to wonder which of them were never going to work.
async function v2BriefAll(subs, force) {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  const camp = V2.campaign(s.campaign);
  const list = (subs && subs.length ? subs
    : camp ? V2.campaignRooms(camp).map((t) => t.sub)
    : (s.subs && s.subs.length ? s.subs : V2.TARGETS.filter(V2.postable).map((t) => t.sub)));
  const fresh = 7 * 86400000;
  let done = 0, read = 0, skipped = 0, blocked = 0;
  await chrome.storage.local.set({ v2All: { running: true, total: list.length, done: 0, where: "", stop: false } });
  for (const sub of list) {
    const { v2All: a = {} } = await chrome.storage.local.get(["v2All"]);
    if (a.stop) break;
    done += 1;
    await chrome.storage.local.set({ v2All: { running: true, total: list.length, done, where: "r/" + sub, stop: false } });
    const cur = await v2Get();
    const had = (cur.briefs || {})[sub];
    if (had && !force && Date.now() - (had.at || 0) < fresh) { skipped += 1; if (had.verdict && had.verdict.blocked) blocked += 1; continue; }
    try {
      const b = await v2RoomBrief(sub, true);
      if (b && b.ok) { read += 1; if (b.verdict && b.verdict.blocked) blocked += 1; }
    } catch (_) { /* one room failing is not the run failing */ }
  }
  await chrome.storage.local.set({ v2All: { running: false, total: list.length, done, where: "", stop: false } });
  return { ok: true, rooms: list.length, read, skipped, blocked, campaign: camp ? camp.name : "" };
}

// ------------------------------------------------------------- the ledger
// Which offer has been run in which room, and how it went. Built from the
// board's own record joined to the tracker, so a post a moderator pulled is
// known even though nothing in here was told about it.
function v2Ledger(st) {
  const out = {};
  const mine = st.mine || {};
  const now = Date.now();
  for (const p of Object.values(st.posts || {})) {
    if (!p.offerKey || !p.sub) continue;
    const m = p.postId ? mine[p.postId] : null;
    const ageH = (now - (p.at || 0)) / 3600000;
    const key = p.offerKey + "|" + p.sub;
    const prev = out[key] || { at: 0, n: 0, removed: false, survived: false };
    out[key] = {
      at: Math.max(prev.at, p.at || 0), n: prev.n + 1,
      removed: prev.removed || !!(m && m.removed),
      survived: prev.survived || (!(m && m.removed) && ageH > 24),
      comments: Math.max(prev.comments || 0, (m && m.comments) || 0),
    };
  }
  return out;
}
function v2Health(st, ledger) {
  const health = {};
  for (const o of V2.allOffers()) health[o.key] = V2.offerHealth(o.key, ledger);
  return health;
}

// One offer, every room, best first — and the chain a blocked day walks along.
async function v2Fit(offerKey, opts = {}) {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  const camp = V2.campaign(s.campaign);
  const offer = V2.offer(offerKey);
  const rooms = opts.all || !camp ? V2.TARGETS : V2.campaignRooms(camp);
  const ledger = v2Ledger(st);
  const chain = V2.fitChain(offer, rooms, {
    briefs: st.briefs || {}, ledger, checked: st.targets || {},
    health: v2Health(st, ledger),
    campaignRooms: camp ? V2.campaignRooms(camp).map((t) => t.sub) : [],
    campaignNiche: camp ? camp.niche : "",
  });
  return { ok: true, offer: { key: offer.key, name: offer.name, posture: offer.posture, who: offer.who },
    chain, health: V2.offerHealth(offer.key, ledger), campaign: camp ? camp.name : "",
    unread: chain.filter((c) => !(st.briefs || {})[c.sub]).length };
}

// Every offer the calendar may use, against every room it may use.
async function v2Matrix() {
  const st = await v2Get();
  v2Apply(st);
  const s = v2Settings(st);
  const camp = V2.campaign(s.campaign);
  const rooms = camp ? V2.campaignRooms(camp) : V2.TARGETS.filter(V2.postable);
  const picked = s.offers && s.offers.length ? s.offers : V2.allOffers().map((o) => o.key);
  const ledger = v2Ledger(st);
  const health = v2Health(st, ledger);
  const rows = picked.map((k) => {
    const offer = V2.offer(k);
    const chain = V2.fitChain(offer, rooms, { briefs: st.briefs || {}, ledger, checked: st.targets || {}, health,
      campaignRooms: rooms.map((t) => t.sub), campaignNiche: camp ? camp.niche : "" });
    return { key: offer.key, name: offer.name, posture: offer.posture, health: health[offer.key],
      cells: chain, green: chain.filter((c) => c.state === "green").length, next: chain.find((c) => c.state === "green" || c.state === "grey") || null };
  });
  rows.sort((a, b) => b.green - a.green);
  return { ok: true, rows, rooms: rooms.map((t) => t.sub), campaign: camp ? camp.name : "", unread: rooms.filter((t) => !(st.briefs || {})[t.sub]).length };
}

// A day whose room turned out to be closed walks to the next room in its
// offer's chain rather than being lost.
async function v2RowFallback(n) {
  const st = await v2Get();
  v2Apply(st);
  const row = (st.plan || []).find((r) => r.n === Number(n));
  if (!row) return { ok: false, error: "no such day" };
  const fit = await v2Fit(row.offerKey);
  const takenToday = new Set((st.plan || []).filter((r) => r.day === row.day && r.n !== row.n).map((r) => r.sub));
  const cool = v2Settings(st).subCoolDays * 86400000;
  const clash = (sub) => (st.plan || []).some((r) => r.n !== row.n && r.sub === sub && Math.abs((r.at || 0) - (row.at || 0)) < cool);
  const next = fit.chain.find((c) => (c.state === "green" || c.state === "grey") && c.sub !== row.sub && !takenToday.has(c.sub) && !clash(c.sub));
  if (!next) return { ok: false, error: "nothing else in this campaign will take this offer — read more rooms, or pick a different offer for the day" };
  const was = row.sub;
  row.sub = next.sub;
  row.kind = next.kind; row.promo = next.promo; row.group = next.kind;
  row.weekly = next.promo === "weekly";
  row.movedFrom = was;
  row.why = row.why.replace("r/" + was, "r/" + next.sub) + " (moved from r/" + was + ")";
  delete st.drafts[row.n];
  if (row.state === "drafted") row.state = "planned";
  await v2Set({ plan: st.plan, drafts: st.drafts });
  return { ok: true, from: was, to: next.sub, why: next.why, state: next.state };
}

// After a bulk read, several days can turn out to be sitting in rooms that
// will never take them. Move them all in one go rather than one at a time.
async function v2FallbackAll() {
  const st = await v2Get();
  const closed = (st.plan || []).filter((r) => {
    if (!r.sub || r.state === "posted" || r.state === "skipped") return false;
    const b = (st.briefs || {})[r.sub];
    return !!(b && b.verdict && b.verdict.blocked);
  });
  const moves = [], stuck = [];
  for (const r of closed) {
    const res = await v2RowFallback(r.n);
    if (res.ok) moves.push({ n: r.n, from: res.from, to: res.to });
    else stuck.push({ n: r.n, sub: r.sub, why: res.error });
  }
  return { ok: true, moved: moves.length, moves, stuck };
}

// -------------------------------------------------- the buyer hunt (v2)
// v1 hunted intent. This hunts money: a post only enters the queue if
// somebody in it has a budget, an agency, or a business of their own.
async function v2Scan(force) {
  const st = await v2Get();
  v2Apply(st);
  // a campaign narrows the scan to its own rooms, its own money searches and
  // the questions its niche asks over and over
  const camp = V2.campaign(v2Settings(st).campaign);
  const subs = camp
    ? V2.campaignRooms(camp).map((t) => t.sub)
    : V2.TARGETS.filter((t) => t.kind !== "biz" || ["smallbusiness", "sweatystartup", "ecommerce", "shopify", "EntrepreneurRideAlong", "Franchising", "msp"].includes(t.sub)).map((t) => t.sub);
  const searches = camp ? camp.searches.concat(V2.SEARCHES.slice(0, 8)) : V2.SEARCHES;
  const urls = [];
  for (const q of searches) urls.push({ url: `https://old.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=week&limit=100&raw_json=1`, why: q });
  // the recurring questions: holding the top answer under these is worth more
  // than any single thread, so they are hunted by name
  for (const q of (camp && camp.queries) || []) urls.push({ url: `https://old.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=month&limit=50&raw_json=1`, why: "Q: " + q, question: true });
  for (const s of subs) urls.push({ url: `https://old.reddit.com/r/${encodeURIComponent(s)}/new.json?limit=100&raw_json=1`, why: "r/" + s });
  const queue = { ...(st.queue || {}) };
  let seen = 0, found = 0, i = 0;
  await chrome.storage.local.set({ v2Scan: { running: true, total: urls.length, done: 0, seen: 0, found: 0, where: "", stop: false } });
  for (const u of urls) {
    i += 1;
    const { v2Scan: sc = {} } = await chrome.storage.local.get(["v2Scan"]);
    if (sc.stop) break;
    await chrome.storage.local.set({ v2Scan: { running: true, total: urls.length, done: i, seen, found, where: u.why, stop: false } });
    let j = null;
    try { j = await huntFetch(u.url); } catch (_) { continue; }
    for (const c of ((j && j.data && j.data.children) || [])) {
      const d = c && c.data;
      if (!d || d.stickied || d.over_18 || !d.author || d.author === "[deleted]") continue;
      seen += 1;
      if (queue[d.id]) continue;
      const cls = V2.classifyBuyer(d.title, d.selftext, d.subreddit);
      if (!cls.keep) continue;
      queue[d.id] = { id: d.id, author: d.author, sub: d.subreddit, title: String(d.title || "").slice(0, 300), body: String(d.selftext || "").replace(/\s+/g, " ").slice(0, 4000),
        permalink: "https://www.reddit.com" + String(d.permalink || ""), created: (d.created_utc || 0) * 1000, comments: d.num_comments || 0,
        tier: cls.tier + (u.question ? 1 : 0), badge: cls.badge, why: u.question ? "one of the questions this niche asks over and over — holding the top answer here pays for months" : cls.why,
        amount: cls.amount || "", found: u.why, question: !!u.question, state: "new" };
      found += 1;
    }
    await new Promise((r) => setTimeout(r, force ? 700 : 1200));
  }
  // nothing older than a fortnight stays in the queue
  const cutoff = Date.now() - 14 * 86400000;
  for (const [id, p] of Object.entries(queue)) if (p.state === "new" && (p.created || 0) < cutoff) delete queue[id];
  await chrome.storage.local.set({ v2Scan: { running: false, total: urls.length, done: i, seen, found, where: "", stop: false } });
  await v2Set({ queue, lastScan: Date.now() });
  return { ok: true, seen, found, sources: urls.length };
}

async function v2QueueList(limit) {
  const st = await v2Get();
  const rows = Object.values(st.queue || {})
    .filter((p) => p.state !== "done" && p.state !== "dropped")
    .sort((a, b) => (b.tier - a.tier) || (b.created - a.created))
    .slice(0, limit || 60);
  const all = Object.values(st.queue || {});
  return { ok: true, rows, total: all.length, tiers: { spending: all.filter((p) => p.badge === "spending").length, owner: all.filter((p) => p.badge === "owner").length, asking: all.filter((p) => p.badge === "asking").length }, lastScan: st.lastScan || 0 };
}

async function v2Answer(id, force) {
  const st = await v2Get();
  const p = (st.queue || {})[id];
  if (!p) return { ok: false, error: "that thread is not in the queue" };
  if (p.answer && !force) return { ok: true, answer: p.answer, cached: true };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  let extra = "";
  let out = null, issues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await v2Ai(V2.answerSystem(profile), V2.answerUser(p, profile) + (extra ? "\n\n" + extra : ""), V2.ANSWER_SCHEMA, 1600, "public answer");
    if (!res.ok) return res;
    issues = V2.answerChecks(res.parsed);
    out = { ...res.parsed, at: Date.now(), model: res.model, cents: res.cents, issues };
    if (!issues.length) break;
    extra = "Your last answer was rejected for these reasons, fix every one: " + issues.join("; ");
  }
  p.answer = out;
  await v2Set({ queue: st.queue });
  return { ok: true, answer: out, issues };
}

async function v2QueueAct(id, action) {
  const st = await v2Get();
  const p = (st.queue || {})[id];
  if (!p) return { ok: false };
  if (action === "answered") { p.state = "done"; p.answeredAt = Date.now(); st.answered = (st.answered || 0) + 1; }
  else if (action === "drop") { p.state = "dropped"; }
  else if (action === "undo") { if (p.answeredAt) st.answered = Math.max(0, (st.answered || 0) - 1); p.state = "new"; delete p.answeredAt; }
  await v2Set({ queue: st.queue, answered: st.answered || 0 });
  return { ok: true };
}

// --------------------------------------------------------------- plumbing
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("v2-")) return;
  const go = (pr) => { pr.then(reply).catch((e) => reply({ ok: false, error: String((e && e.message) || e) })); return true; };
  switch (msg.type) {
    case "v2-board": return go(v2Board());
    case "v2-plan": return go(v2Plan(msg.opts || {}));
    case "v2-settings": return go(v2Get().then((st) => v2Set({ settings: { ...v2Settings(st), ...(msg.settings || {}) } })).then(() => ({ ok: true })));
    case "v2-draft": return go(v2Draft(msg.n, msg.force));
    case "v2-draft-save": return go(v2DraftSave(msg.n, msg.patch || {}));
    case "v2-open": return go(v2Open(msg.n, !!msg.force));
    case "v2-pending": return go(v2Pending().then((p) => p || { none: true }));
    case "v2-posted": return go(v2MarkPosted(msg.n, msg.url));
    case "v2-skip": return go(v2Skip(msg.n, msg.why));
    case "v2-leads": return go(v2Get().then((st) => ({ ok: true, rows: Object.values(st.leads || {}).sort((a, b) => (b.tier - a.tier) || (b.at - a.at)), lastLeads: st.lastLeads || 0 })));
    case "v2-lead-poll": return go(v2LeadPoll());
    case "v2-lead-act": return go(v2LeadAct(msg.id, msg.action, msg.note));
    case "v2-targets": return go(v2Get().then((st) => { v2Apply(st); return { ok: true, targets: V2.TARGETS, checked: st.targets || {}, kinds: V2.KINDS, promo: V2.PROMO, picked: v2Settings(st).subs || [], lastCheck: st.lastCheck || 0 }; }));
    case "v2-check-targets": return go(v2CheckTargets(msg.only));
    case "v2-check-state": return go(chrome.storage.local.get(["v2Check"]).then((x) => x.v2Check || { running: false }));
    case "v2-check-stop": return go(chrome.storage.local.get(["v2Check"]).then((x) => chrome.storage.local.set({ v2Check: { ...(x.v2Check || {}), stop: true } })).then(() => ({ ok: true })));
    case "v2-rooms": return go(v2Rooms(msg.picked));
    case "v2-offers": return go(v2Offers());
    case "v2-shape": return go(v2Shape(msg.sub, !!msg.force));
    case "v2-brief-all": return go(v2BriefAll(msg.subs, !!msg.force));
    case "v2-brief-all-state": return go(chrome.storage.local.get(["v2All"]).then((x) => x.v2All || { running: false }));
    case "v2-brief-all-stop": return go(chrome.storage.local.get(["v2All"]).then((x) => chrome.storage.local.set({ v2All: { ...(x.v2All || {}), stop: true } })).then(() => ({ ok: true })));
    case "v2-fit": return go(v2Fit(msg.key, msg.opts || {}));
    case "v2-matrix": return go(v2Matrix());
    case "v2-fallback-all": return go(v2FallbackAll());
    case "v2-row-fallback": return go(v2RowFallback(msg.n));
    case "v2-brief": return go(v2RoomBrief(msg.sub, !!msg.force));
    case "v2-brief-state": return go(chrome.storage.local.get(["v2Brief"]).then((x) => x.v2Brief || { running: false }));
    case "v2-brief-stop": return go(chrome.storage.local.get(["v2Brief"]).then((x) => chrome.storage.local.set({ v2Brief: { ...(x.v2Brief || {}), stop: true } })).then(() => ({ ok: true })));
    case "v2-rules-read": return go(v2RulesRead(msg.sub, !!msg.force));
    case "v2-room-offers": return go(v2RoomOffers(msg.sub, !!msg.force, msg.extra));
    case "v2-offer-improve": return go(v2OfferImprove(msg.key, msg.note));
    case "v2-row-offer": return go(v2RowOffer(msg.n, msg.key));
    case "v2-offer-make": return go(v2OfferMake(msg.brief));
    case "v2-offer-keep": return go(v2OfferKeep(msg.key));
    case "v2-offer-forget": return go(v2OfferForget(msg.key));
    case "v2-offer-pick": return go(v2OfferPick(msg.keys));
    case "v2-scan": return go(v2Scan(true));
    case "v2-scan-state": return go(chrome.storage.local.get(["v2Scan"]).then((x) => x.v2Scan || { running: false }));
    case "v2-scan-stop": return go(chrome.storage.local.get(["v2Scan"]).then((x) => chrome.storage.local.set({ v2Scan: { ...(x.v2Scan || {}), stop: true } })).then(() => ({ ok: true })));
    case "v2-queue": return go(v2QueueList(msg.limit));
    case "v2-answer": return go(v2Answer(msg.id, !!msg.force));
    case "v2-queue-act": return go(v2QueueAct(msg.id, msg.action));
    case "v2-campaigns": return go(v2Campaigns());
    case "v2-campaign-set": return go(v2CampaignSet(msg.key));
    case "v2-mine": return go(v2MineList(msg.opts || {}));
    case "v2-mine-read": return go(v2TrackMine(msg.pages));
    case "v2-boosts": return go(v2BoostList());
    case "v2-boost-add": return go(v2BoostAdd(msg.id, msg.daily, msg.days));
    case "v2-boost-spend": return go(v2BoostSpend(msg.id, msg.spent));
    case "v2-boost-stop": return go(v2BoostStop(msg.id, msg.why));
    case "v2-budget": return go(v2Get().then((st) => v2Set({ settings: { ...v2Settings(st), dailyBudget: Math.max(1, Number(msg.daily) || 7) } })).then(() => ({ ok: true })));
    case "v2-reset": return go(chrome.storage.local.set({ [V2_STORE]: { ...V2_EMPTY } }).then(() => ({ ok: true })));
    default: return;
  }
});

// One wake an hour: pull comments on our own posts so leads appear without
// anybody pressing anything. Nothing is ever posted without a person.
chrome.alarms.create("v2-tick", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "v2-tick") return;
  v2LeadPoll().catch(() => {});
  v2TrackMine(2).catch(() => {});
});
