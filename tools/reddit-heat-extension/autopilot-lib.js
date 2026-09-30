// Autopilot, the parts that need no browser: reading a Telegram command,
// deciding whether a post is a moderator's, and choosing the next person to
// message. Kept apart from autopilot.js so `node autopilot-test.js` can run it.
(function (root) {
  const AP = {};

  // "auto on", "auto mode on", "autopilot on", "/auto_on", "on"  -> "on"
  // "off", "auto off", "auto mode off", "stop"                   -> "off"
  // "status", "auto status"                                       -> "status"
  // Anything else is not a command and changes nothing.
  AP.parseCommand = function (text) {
    const t = String(text || "").toLowerCase().replace(/@[a-z0-9_]+/g, " ").replace(/[^a-z]+/g, " ").trim();
    if (!t) return "";
    const m = t.match(/^(?:start )?(?:auto ?pilot|auto)?(?: ?mode)? ?(on|off|status|stop|start|pause|resume)$/);
    if (!m) return t === "start" ? "help" : "";
    const w = m[1];
    if (w === "on" || w === "resume") return "on";
    if (w === "off" || w === "stop" || w === "pause") return "off";
    if (w === "status") return "status";
    // a bare "/start" is Telegram's own greeting, not "turn it on"
    if (w === "start") return /auto/.test(t) ? "on" : "help";
    return "";
  };

  // A post the moderators made: marked by Reddit as a mod or admin post,
  // pinned, written by AutoModerator, or written by someone on that
  // subreddit's moderator list.
  AP.isModPost = function (p, mods) {
    if (!p) return true;
    const a = String(p.author || "").toLowerCase();
    if (!a || a === "[deleted]" || a === "automoderator") return true;
    if (p.distinguished || p.stickied) return true;
    if (/-modteam$/i.test(a)) return true;
    const list = Array.isArray(mods) ? mods : [];
    return list.some((m) => String(m || "").toLowerCase() === a);
  };

  // The rules a post must meet before any money is spent screening it. Each
  // one is about whether a DM is likely to be read and answered.
  AP.RULES = {
    backMin: 60,       // on switch-on, also take posts found in the last hour
    maxAgeH: 6,        // a post older than this has had its answers
    maxComments: 20,   // a crowded thread: the founder is already swamped
    minFit: 35,        // the board's own fit score (freshness, role, money, stage, effort)
    minBody: 120,      // a real post, not a one-line title
    gapMinS: 240,      // at least 4 minutes between two DMs...
    gapMaxS: 480,      // ...and up to 8, at random
    watchFirst: 3,     // the first few DMs after switching on open in front of you
  };
  AP.rules = function (saved) {
    const r = { ...AP.RULES };
    for (const k of Object.keys(AP.RULES)) {
      const v = Number(saved && saved[k]);
      if (saved && saved[k] !== undefined && saved[k] !== "" && isFinite(v) && v >= 0) r[k] = v;
    }
    r.gapMinS = Math.max(60, r.gapMinS);                 // never faster than a minute
    r.gapMaxS = Math.max(r.gapMinS, r.gapMaxS);
    r.watchFirst = Math.min(10, Math.round(r.watchFirst));
    return r;
  };
  // The seconds before the next DM may go.
  AP.gapMs = function (rules, rand = Math.random) {
    const r = AP.rules(rules);
    return Math.round((r.gapMinS + rand() * (r.gapMaxS - r.gapMinS)) * 1000);
  };
  // Relevant and likely to answer? "" when yes, else why not. `fit` is the
  // board's own score for the post (HEAT.huntScore).
  AP.convertReason = function (p, rules, now = Date.now(), fit = null) {
    const r = AP.rules(rules);
    const ageH = p.created ? (now - p.created) / 3600000 : 0;
    if (r.maxAgeH > 0 && ageH > r.maxAgeH) return `posted ${Math.round(ageH)}h ago, over ${r.maxAgeH}h`;
    if ((p.comments || 0) > r.maxComments) return `${p.comments} comments already, over ${r.maxComments}`;
    if (String(p.body || "").trim().length < r.minBody) return "too short to be a real ask";
    if (fit !== null && fit < r.minFit) return `fit ${fit}, under ${r.minFit}`;
    return "";
  };
  // A skip caused by the setup, not by the post: undone when the setup is fixed.
  AP.setupSkip = (why) => /no Claude key saved|AI budget is used up/i.test(String(why || ""));

  // Why this post cannot be messaged by the autopilot, or "" when it can.
  AP.blockReason = function (p, ctx) {
    const { since = 0, contacted = {}, done = {}, me = "", now = Date.now(), maxAgeH = 48 } = ctx || {};
    if (!p || !p.id) return "no post";
    if (done[p.id]) return "already handled";
    if ((p.firstSeen || 0) < since) return "found before autopilot was switched on";
    if (p.act) return "skipped";
    if (p.dmAt) return "already messaged";
    if (p.repliedAt) return "you already replied to it";
    // Auto mode is for the co-founder hunt. Hiring and project posts want a
    // quote and a date, so they wait on the board for you.
    if (p.hunt && p.hunt !== "cofounder") return "a Hiring or project post, left for you";
    if (p.mine) return "you already commented there";
    if (p.laterUntil && p.laterUntil > now) return "snoozed";
    if (p.created && now - p.created > maxAgeH * 3600000) return "too old";
    const a = String(p.author || "").toLowerCase();
    if (!a) return "no author";
    if (me && a === String(me).toLowerCase()) return "your own post";
    if (contacted[a]) return "this person was already contacted";
    if (AP.isModPost(p, [])) return "moderator post";
    return "";
  };

  // The next one to message: oldest new find first, one per person.
  AP.pickNext = function (posts, ctx) {
    const list = Object.values(posts || {}).filter((p) => !AP.blockReason(p, ctx));
    list.sort((x, y) => (x.firstSeen || 0) - (y.firstSeen || 0) || (x.created || 0) - (y.created || 0));
    return list[0] || null;
  };

  // The DM that goes out: the writer's long letter, else its short one.
  // Nothing written by Claude means nothing to send.
  AP.dmText = function (p) {
    const ai = p && p.ai;
    if (!ai) return "";
    return String(ai.dm_long || ai.dm_short || "").trim();
  };

  // Only a draft that came through the Claude API counts as screened.
  AP.screenedByClaude = function (p) {
    const ai = p && p.ai;
    if (!ai || ai.fit === "no") return false;
    const m = String(ai.model || "");
    return m === "template+slots" || (/^claude-/.test(m) && m !== "claude-chrome");
  };

  AP.clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

  AP.statusText = function (st, gate, waiting) {
    const lines = [];
    lines.push("Autopilot is " + (st.on ? "ON" : "OFF") + ".");
    if (st.on && st.blocked) lines.push("PAUSED: " + st.blocked + ".");
    lines.push("Private DMs only. Nothing is posted in public.");
    if (gate) lines.push(`DMs sent today: ${gate.sentToday} of ${gate.cap}.`);
    if (typeof waiting === "number") lines.push(`New finds waiting: ${waiting}.`);
    if (st.job) lines.push(`Sending now: u/${st.job.author}.`);
    const last = (st.log || [])[0];
    if (last) lines.push(`Last: ${last.what}${last.who ? " (u/" + last.who + ")" : ""}.`);
    return lines.join("\n");
  };

  root.AP = AP;
  if (typeof module !== "undefined" && module.exports) module.exports = AP;
})(typeof globalThis !== "undefined" ? globalThis : this);
