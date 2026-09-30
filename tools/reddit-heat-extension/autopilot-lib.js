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

  // Why this post cannot be messaged by the autopilot, or "" when it can.
  AP.blockReason = function (p, ctx) {
    const { since = 0, contacted = {}, done = {}, me = "", now = Date.now(), maxAgeH = 48 } = ctx || {};
    if (!p || !p.id) return "no post";
    if (done[p.id]) return "already handled";
    if ((p.firstSeen || 0) < since) return "found before autopilot was switched on";
    if (p.act) return "skipped";
    if (p.dmAt) return "already messaged";
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
