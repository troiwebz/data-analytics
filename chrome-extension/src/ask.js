// Ask mode (1.21.0): type a request to the Telegram bot in plain words and get the matching BHW threads back.
// "Check what's new", "Find PBN related threads in the last 24 hours", "guest outreach, last 7 days".
// Pure logic only: Claude turns the sentence into a plan (what to search, how far back), a rule-based reader does
// the same when Claude is unavailable, and one message lists the threads. Nothing here posts, replies or sends a PM.

const HOUR = 3600000;
const ms = (iso) => { const n = new Date(iso || 0).getTime(); return isFinite(n) ? n : 0; };
const h = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const ASK_MAX_HOURS = 30 * 24;
export const ASK_DEFAULT_HOURS = 7 * 24;
export const ASK_MAX_TERMS = 4;
export const ASK_SHOW = 8;
/** Boards Ask never lists: marketplaces, hiring, intros. SEO boards (Black Hat SEO, Link Building...) are exactly what it is for. */
export const ASK_DENY = /hire a freelancer|want to buy|marketplace|for sale|selling|renting|packages|introductions|dispute|lounge|journey|giveaways|freebies/i;

/** Plain commands Ask may run for you ("turn off new threads"). Anything else is just answered in words. */
export const ASK_COMMANDS = /^(radar|radar help|families|new threads|new threads on|new threads off|online|online now)$/i;

export const ASK_SYSTEM = [
  'You are the assistant inside a private Telegram bot that watches the BlackHatWorld SEO forum for its owner. The owner types',
  'requests in plain words. Turn each one into a JSON plan. You only plan; the bot does the searching.',
  '',
  'kind:',
  '  "search"  - the owner wants threads about a topic (PBN, guest posts, guest outreach, link building, tools, an ad network...).',
  '  "new"     - the owner wants whatever is new on the forum ("check what\'s new", "new threads"); terms may be empty or a topic filter.',
  '  "command" - the owner asks the bot to do one of: radar, radar help, families, new threads, new threads on, new threads off, online, online now. Put it in "command".',
  '  "watch"   - the owner wants to be NOTIFIED when new threads about topics appear ("notify me when new threads come in SEO, guest outreach and content writing"), or to change that list ("also watch link building", "stop watching content writing", "what am I watching", "pause alerts"). Give "op" (add, remove, list, pause, resume) and "watches": one entry per topic, each {"label":"short name","terms":[3-6 phrases people put in a thread title for it]}. For remove only the label is needed.',
  '  "chat"    - a question or remark with no search in it ("how many replies today?", "what can you do?"). Put a short plain answer in "reply", using the STATUS given.',
  '',
  'For "search": give 2-4 "terms" that people on a forum would actually type in a thread title for that topic: the topic itself,',
  'its common abbreviation and one or two natural alternatives. Short phrases, lower case, no quotes, no operators.',
  'For "new" with a topic: 1-3 terms to filter by. "hours" is how far back to look: from the words ("last 24 hours" = 24, "today" = 24,',
  '"this week" = 168, "last 3 days" = 72, "last month" = 720). No time given: 168 for search, 24 for new. Never above 720.',
  '"limit": how many threads they asked for (3-10), default 8.',
  '"again": true only if they ask to see threads again / including ones already sent.',
  '"zero": true if they only want threads nobody has replied to yet.',
  'If PREVIOUS is given and the request refers to it ("same but last 7 days", "only unanswered", "more"), keep what is not changed.',
  'Return ONLY JSON: {"kind":"search|new|watch|command|chat","terms":[],"hours":168,"limit":8,"again":false,"zero":false,"command":"","reply":"","op":"","watches":[],"say":"one short line saying what you will look for"}'
].join('\n');

export function askPrompt(message, { now = Date.now(), previous = null, status = '' } = {}) {
  return [
    `TODAY: ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    status ? `STATUS: ${status}` : '',
    previous ? `PREVIOUS: ${JSON.stringify({ request: previous.text, kind: previous.plan?.kind, terms: previous.plan?.terms, hours: previous.plan?.hours })}` : '',
    `REQUEST: ${String(message).slice(0, 400)}`
  ].filter(Boolean).join('\n');
}

const clean = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 .+&#-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Validate Claude's plan. Anything off becomes null and the rule-based reader takes over. */
export function parseAsk(text) {
  let o;
  try { const m = String(text || '').match(/\{[\s\S]*\}/); o = JSON.parse(m ? m[0] : text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const kind = String(o.kind || '').toLowerCase();
  if (!['search', 'new', 'watch', 'command', 'chat'].includes(kind)) return null;
  const terms = [...new Set((Array.isArray(o.terms) ? o.terms : []).map(clean).filter((t) => t.length >= 2))].slice(0, ASK_MAX_TERMS);
  const plan = {
    kind, terms,
    hours: Math.min(ASK_MAX_HOURS, Math.max(1, Math.round(Number(o.hours) || (kind === 'new' ? 24 : ASK_DEFAULT_HOURS)))),
    limit: Math.min(10, Math.max(3, Math.round(Number(o.limit) || ASK_SHOW))),
    again: o.again === true, zero: o.zero === true,
    command: String(o.command || '').trim().toLowerCase(), reply: String(o.reply || '').trim().slice(0, 900),
    say: String(o.say || '').trim().slice(0, 200),
    op: String(o.op || '').toLowerCase(),
    watches: (Array.isArray(o.watches) ? o.watches : []).map((w) => ({ label: clean(w && w.label), terms: [...new Set((Array.isArray(w && w.terms) ? w.terms : []).map(clean).filter((t) => t.length >= 2))].slice(0, 6) })).filter((w) => w.label).slice(0, 8)
  };
  if (kind === 'search' && !terms.length) return null;
  if (kind === 'command' && !ASK_COMMANDS.test(plan.command)) return { ...plan, kind: 'chat', command: '', reply: 'I can search BHW, show what is new, and run: radar, radar help, families, new threads on / off, online. I cannot do that one.' };
  if (kind === 'chat' && !plan.reply) return null;
  if (kind === 'watch') {
    if (!['add', 'remove', 'list', 'pause', 'resume'].includes(plan.op)) return null;
    if ((plan.op === 'add' || plan.op === 'remove') && !plan.watches.length) return null;
    if (plan.op === 'add') for (const w of plan.watches) if (!w.terms.length) w.terms = [w.label];
  }
  return plan;
}

// ---------------------------------------------------------------- the reader that needs no Claude

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const UNIT = { h: 1, hr: 1, hrs: 1, hour: 1, hours: 1, d: 24, day: 24, days: 24, w: 168, wk: 168, week: 168, weeks: 168, m: 720, month: 720, months: 720 };

/** Hours from the words: "last 24 hours", "in 3 days", "past week", "today", "yesterday", "7d". null when no time was said. */
export function hoursFrom(text) {
  const t = String(text || '').toLowerCase();
  let m = t.match(/\b(\d{1,3}|an?|one|two|three|four|five|six|seven|ten|twelve|fifteen|twenty)\s*(h|hrs?|hours?|d|days?|w|wks?|weeks?|months?)\b/);
  if (m) { const n = /^\d/.test(m[1]) ? Number(m[1]) : NUM[m[1]]; return Math.min(ASK_MAX_HOURS, Math.max(1, n * UNIT[m[2]])); }
  if (/\b(past|last|this)\s+(week)\b/.test(t)) return 168;
  if (/\b(past|last|this)\s+(month)\b/.test(t)) return 720;
  if (/\b(yesterday)\b/.test(t)) return 48;
  if (/\b(today|tonight|last night|this morning|just now|right now)\b/.test(t)) return 24;
  return null;
}

const FILLER = /\b(please|pls|can you|could you|check|checking|find|finding|show|get|give|search|look(?:ing)?(?: for| up)?|list|fetch|bring|me|us|my|any|all|some|the|a|an|new|newest|latest|fresh|recent|recently|threads?|posts?|topics?|related|relating|about|regarding|on|for|in|at|of|to|from|within|during|over|past|last|this|ago|since|today|yesterday|tonight|week|weeks|day|days|hours?|hrs?|months?|and|or|with|that|are|is|there|what|whats|what's|which|who|has|have|anything|something|stuff|forum|bhw|blackhatworld|discussions?|ones?|only|just|unanswered|zero|replies|reply|again|more)\b/g;

/** A request read by rules: the same plan Claude would give, less clever about which words to search. */
export function ruleAsk(message) {
  const t = String(message || '').trim();
  const lower = t.toLowerCase();
  const hours = hoursFrom(lower);
  const topic = clean(lower.replace(/\b\d{1,3}\s*(h|hrs?|hours?|d|days?|w|wks?|weeks?|months?)\b/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' '));
  const common = { hours: hours || ASK_DEFAULT_HOURS, limit: ASK_SHOW, again: /\b(again|including|already sent|all of them)\b/.test(lower), zero: /\b(unanswered|no replies|zero replies|0 replies|first reply|not replied)\b/.test(lower), command: '', reply: '', say: '' };
  const wp = ruleWatch(t);
  if (wp) return wp;
  let m;
  if ((m = lower.match(/\b(turn|switch)\s+(on|off)\b.*\bnew\s*threads?\b|\bnew\s*threads?\s+(on|off)\b/))) {
    const on = (m[2] || m[3]) === 'on';
    return { kind: 'command', terms: [], ...common, command: on ? 'new threads on' : 'new threads off' };
  }
  if (/^((ok|okay|thanks?|thank you|thx|yes|yep|no|nope|hi|hello|hey|cool|nice|great|done|good|fine|k|bro|sir|da)\b[\s!.,]*)+$/.test(lower)) return { kind: 'chat', terms: [], ...common, reply: 'Tell me what to find, for example: find PBN threads in the last 24 hours, or check what\'s new.' };
  if (/\b(what can you do|help|commands?)\b/.test(lower) && !topic) return { kind: 'command', terms: [], ...common, command: 'radar help' };
  if (/\b(status|how am i doing|how many (replies|public))\b/.test(lower)) return { kind: 'command', terms: [], ...common, command: 'radar' };
  if (/\b(new|latest|fresh|what'?s\s*new|whats\s*new|recent)\b/.test(lower)) return { kind: 'new', terms: topic ? [topic] : [], ...common, hours: hours || 24 };
  if (topic) return { kind: 'search', terms: [topic], ...common };
  return null;
}

// ---------------------------------------------------------------- picking and showing

/**
 * Candidates -> what to list. `rows` carry threadId, url, title, forum, replyCount, lastActivityAt, startedAt, snippet.
 * Out: sales threads, muted words, hidden, anything you replied to or marked, locked, stickies, outside the time window.
 * Already-sent threads only come back if the request said "again".
 */
export function pickAsk(rows, plan, state, { now = Date.now(), muted = [], deny = null, sales = null, iPosted = () => false, isMuted = () => false } = {}) {
  const window = plan.hours * HOUR;
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.threadId || !r.title || !r.url) continue;
    if (r.sticky || r.locked || r.mine) continue;
    if (deny && deny.test(r.forum || '')) continue;
    if (sales && sales.test(r.title)) continue;
    if (isMuted(r.title, muted)) continue;
    const id = String(r.threadId);
    if (iPosted(state, id) || state?.hidden?.[id]) continue;
    if (!plan.again && state?.sent?.[id]) continue;
    const at = ms(r.lastActivityAt) || ms(r.startedAt);
    const started = ms(r.startedAt);
    // "New" means started inside the window; a search means anything active inside it.
    if (plan.kind === 'new' ? !(started ? now - started <= window : at && now - at <= window) : !(at && now - at <= window)) continue;
    if (plan.zero && Number(r.replyCount) > 0) continue;
    const cur = by.get(id);
    if (!cur) by.set(id, { ...r, threadId: id, hits: r.hits || 1 });
    else { cur.hits = (cur.hits || 1) + (r.hits || 1); if ((r.snippet || '').length > (cur.snippet || '').length) cur.snippet = r.snippet; }
  }
  return [...by.values()].sort((a, b) => (ms(b.lastActivityAt) || ms(b.startedAt)) - (ms(a.lastActivityAt) || ms(a.startedAt)));
}

/** A title that carries at least one of the terms (whole word / phrase), for a "new" request with a topic. */
export function titleHasTerm(title, terms) {
  const t = String(title || '').toLowerCase();
  return (terms || []).some((w) => new RegExp(`(^|[^a-z0-9])${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?')}([^a-z0-9]|$)`, 'i').test(t));
}

export const RANK_SYSTEM = [
  'You rank BlackHatWorld threads for one request from the forum owner. Each thread has an id, title, board, replies, last activity and a snippet.',
  'Keep only threads that really are about what was asked (a PBN request wants PBN discussion, not an ad for a PBN service). Put the most useful',
  'to join first: an open question, few replies, recent. For each kept thread give one short line (max 14 words) on what it is about. Plain English, no hype.',
  'Return ONLY JSON: {"keep":[{"id":"threadId","why":"..."}]}  (at most LIMIT threads; empty list if none fit)'
].join('\n');
export const rankPrompt = (request, rows, limit) => [`REQUEST: ${request}`, `LIMIT: ${limit}`, '', ...rows.slice(0, 40).map((r) => `${r.threadId} | ${String(r.title).slice(0, 110)} | ${r.forum || ''} | ${r.replyCount ?? 0} replies | ${String(r.lastActivityAt || r.startedAt || '').slice(0, 16)} | ${String(r.snippet || '').slice(0, 200)}`)].join('\n');

/** Claude's keep-list -> the rows, in its order, each with its `why`. Unknown ids are ignored. */
export function parseRank(text, rows) {
  let o;
  try { const m = String(text || '').match(/\{[\s\S]*\}/); o = JSON.parse(m ? m[0] : text); } catch { return null; }
  if (!o || !Array.isArray(o.keep)) return null;
  const by = new Map(rows.map((r) => [String(r.threadId), r]));
  const out = [], seen = new Set();
  for (const k of o.keep) {
    const id = String(k && k.id);
    if (!by.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...by.get(id), why: String(k.why || '').trim().slice(0, 140) });
  }
  return out;
}

const when = (iso, now) => { const hrs = (now - ms(iso)) / HOUR; return hrs < 1 ? 'under 1h ago' : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)} days ago`; };

export function formatAsk(items, plan, { request = '', now = Date.now(), count = 0, target = 10, more = 0, funnel = '', traffic = '', note = '' } = {}) {
  const span = plan.hours % 24 === 0 && plan.hours >= 48 ? `${plan.hours / 24} days` : `${plan.hours} hour${plan.hours === 1 ? '' : 's'}`;
  const what = plan.kind === 'new' ? `New threads${plan.terms.length ? ` about ${plan.terms.join(' / ')}` : ''}` : plan.terms.join(' / ');
  const lines = [`🤖 <b>${h(what)}</b> · last ${span} · ${items.length} thread${items.length === 1 ? '' : 's'}`, ''];
  items.forEach((q, i) => {
    const rep = Number(q.replyCount) || 0;
    lines.push(`<b>${i + 1}. ${rep === 0 ? '🔥 ' : ''}<a href="${h(q.url)}">${h(q.title)}</a></b>`);
    lines.push(`   ${h(q.forum || q.section || '')} · ${rep} repl${rep === 1 ? 'y' : 'ies'} · ${plan.kind === 'new' && q.startedAt ? `started ${when(q.startedAt, now)}` : `last reply ${when(q.lastActivityAt, now)}`}`);
    if (q.why) lines.push(`   ${h(q.why)}`);
  });
  lines.push('');
  if (note) lines.push(h(note));
  if (more > 0) lines.push(`${more} more matched. Send "more" to see them.`);
  if (funnel) lines.push(funnel);
  lines.push(`Public replies today: <b>${count} of ${target}</b>`);
  if (traffic) lines.push(traffic);
  lines.push('Ask me anything like: new threads in the last 6 hours · guest posts last 3 days · pbn, only unanswered · same but last 7 days');
  return lines.join('\n').slice(0, 3900);
}

export const ASK_HELP = [
  '🤖 <b>Ask me in plain words</b>',
  'Type what you want, no command words needed:',
  '• check what\'s new',
  '• find PBN related threads in the last 24 hours',
  '• guest outreach, last 7 days',
  '• new threads about link building today',
  '• only the ones nobody replied to  (after a search: keeps the topic)',
  '• same but last 3 days',
  '• more  (the next ones from the last answer)',
  '• notify me when new threads come in SEO, guest outreach, content writing  (alerts every 15 minutes)',
  '• also watch link building · stop watching content writing · alerts · pause alerts',
  '',
  'I search BlackHatWorld while signed in, skip anything you already replied to, anything sent before, and sales posts.',
  'Every thread has ✅ I replied / ⏭ Not relevant buttons. I never post or message anyone.',
  'Turn it off with "ask off", on with "ask on". The older commands (next, family, brief...) still work.'
].join('\n');


// ---------------------------------------------------------------- alerts ("notify me when new threads come in SEO, guest outreach...")

export const slug = (label) => clean(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const WATCH_FILLER = /\b(please|pls|can you|could you|will you|notify|notification|notifications|alert|alerts|remind|reminder|reminders|ping|tell|let|know|me|us|my|when|whenever|if|new|newest|latest|fresh|threads?|posts?|topics?|come|comes|coming|in|on|about|for|regarding|related|any|all|also|too|as well|watch|watching|track|tracking|follow|following|add|stop|remove|drop|unwatch|cancel|delete|no more|anymore|the|a|an|to|of|section|forum|bhw|topic|is|are|there|appear|appears|show|up|keep|start|send|get|want)\b/g;

/** "SEO, guest outreach and content writing" -> ["seo", "guest outreach", "content writing"]. */
export function topicsFrom(text) {
  return String(text || '').toLowerCase().replace(WATCH_FILLER, ',').split(/,|\band\b|\bor\b|&|\+|\//).map(clean).filter((t) => t.length >= 2 && !/^(ok|yes|no)$/.test(t)).slice(0, 8);
}

/** An alert request read by rules (no Claude): add / remove / list / pause / resume, or null when it is not about alerts. */
export function ruleWatch(message) {
  const t = String(message || '').toLowerCase().trim();
  const base = { kind: 'watch', terms: [], hours: ASK_DEFAULT_HOURS, limit: ASK_SHOW, again: false, zero: false, command: '', reply: '', say: '', op: '', watches: [] };
  if (/^(alerts?|watchlist|watching|my alerts|what am i (watching|tracking)|(list|show) (my )?(alerts|watches|watchlist|reminders))\s*[?.!]*$/.test(t)) return { ...base, op: 'list' };
  if (/\b(pause|mute|silence|snooze)\b.*\b(alerts?|notifications?|reminders?)\b|\b(alerts?|notifications?|reminders?)\s+off\b/.test(t)) return { ...base, op: 'pause' };
  if (/\b(resume|unmute|unpause)\b.*\b(alerts?|notifications?|reminders?)\b|\b(alerts?|notifications?|reminders?)\s+on\b/.test(t)) return { ...base, op: 'resume' };
  const about = /\b(alerts?|notify|notification|remind\w*|ping|let me know|tell me when|watch\w*|track\w*)\b/.test(t);
  if (!about) return null;
  if (/\b(stop|remove|drop|unwatch|cancel|delete|no more|don'?t)\b/.test(t)) { const w = topicsFrom(t); return w.length ? { ...base, op: 'remove', watches: w.map((l) => ({ label: l, terms: [] })) } : null; }
  if (/\b(notify|alert|remind\w*|ping|let me know|tell me when|watch\w*|track\w*|follow)\b/.test(t)) { const w = topicsFrom(t); return w.length ? { ...base, op: 'add', watches: w.map((l) => ({ label: l, terms: [l] })) } : null; }
  return null;
}

/** Apply an alert change to the saved list. `list` entries: {id,label,terms,on,addedAt}. Returns the new list and what happened. */
export function applyWatch(list, plan, now = Date.now()) {
  const cur = (list || []).map((w) => ({ ...w }));
  const done = { added: [], extended: [], removed: [], missing: [] };
  if (plan.op === 'add') {
    for (const w of plan.watches) {
      const id = slug(w.label); if (!id) continue;
      const have = cur.find((x) => x.id === id);
      if (have) { const before = have.terms.length; have.terms = [...new Set([...have.terms, ...(w.terms.length ? w.terms : [w.label])])].slice(0, 12); have.on = true; (have.terms.length > before ? done.extended : done.added).push(have.label); }
      else { cur.push({ id, label: w.label, terms: (w.terms.length ? w.terms : [w.label]).slice(0, 8), on: true, addedAt: now }); done.added.push(w.label); }
    }
  } else if (plan.op === 'remove') {
    for (const w of plan.watches) {
      const id = slug(w.label);
      const i = cur.findIndex((x) => x.id === id || x.id.includes(id) || id.includes(x.id) || x.terms.includes(clean(w.label)));
      if (i >= 0) { done.removed.push(cur[i].label); cur.splice(i, 1); } else done.missing.push(w.label);
    }
  }
  return { list: cur, ...done };
}

/**
 * New threads for each alert. `rows` = the What's-new page (threadId, url, title, forum, startedAt, replyCount...).
 * A thread is offered once, ever (`seen`), under the first alert whose words its title carries, and only if it started
 * inside `hours` (a new alert does not dump the backlog) with at most 5 replies. Same exclusions as every Radar message.
 */
export function matchWatches(rows, watches, state, { now = Date.now(), hours = 6, seen = {}, muted = [], deny = ASK_DENY, sales = null, iPosted = () => false, isMuted = () => false } = {}) {
  const groups = new Map();
  const taken = new Set();
  for (const r of rows || []) {
    if (!r || !r.threadId || !r.title || !r.url || r.sticky || r.locked || r.mine) continue;
    const id = String(r.threadId);
    if (seen[id] || taken.has(id) || state?.sent?.[id] || iPosted(state, id) || state?.hidden?.[id]) continue;
    if (deny && deny.test(r.forum || '')) continue;
    if (sales && sales.test(r.title)) continue;
    if (isMuted(r.title, muted)) continue;
    const started = ms(r.startedAt) || ms(r.lastActivityAt);
    if (!started || now - started > hours * HOUR) continue;
    if ((Number(r.replyCount) || 0) > 5) continue;
    const w = (watches || []).find((x) => x.on !== false && titleHasTerm(r.title, x.terms) && started >= (x.addedAt || 0) - 3 * HOUR);
    if (!w) continue;
    taken.add(id);
    if (!groups.has(w.id)) groups.set(w.id, { watch: w, items: [] });
    groups.get(w.id).items.push({ ...r, threadId: id });
  }
  return [...groups.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => (ms(b.startedAt) || ms(b.lastActivityAt)) - (ms(a.startedAt) || ms(a.lastActivityAt))) }));
}

/** One message for a tick, a section per alert. `shown` = the threads in order (for the buttons). */
export function formatWatch(groups, { now = Date.now(), count = 0, target = 10, watches = [], max = 8 } = {}) {
  let left = max; const shown = [];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const d = new Date(now);
  const lines = [`🔔 <b>New threads for your alerts</b> · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${Math.min(total, max)} new`, ''];
  let n = 0;
  for (const g of groups) {
    const take = g.items.slice(0, Math.max(0, left)); if (!take.length) continue;
    left -= take.length;
    lines.push(`<b>${h(g.watch.label)}</b>`);
    for (const q of take) {
      n++; shown.push(q);
      const rep = Number(q.replyCount) || 0;
      lines.push(`${n}. ${rep === 0 ? '🔥 ' : ''}<a href="${h(q.url)}">${h(q.title)}</a>`, `   ${h(q.forum || q.section || '')} · started ${when(q.startedAt || q.lastActivityAt, now)} · ${rep} repl${rep === 1 ? 'y' : 'ies'}`);
    }
    lines.push('');
  }
  if (total > max) lines.push(`${total - max} more waiting; they come with the next check.`);
  lines.push(`Public replies today: <b>${count} of ${target}</b>`);
  lines.push(`Watching: ${watches.filter((w) => w.on !== false).map((w) => h(w.label)).join(', ') || 'nothing'} · say "also watch link building", "stop watching content writing", "alerts", "pause alerts"`);
  return { text: lines.join('\n').slice(0, 3900), shown };
}

export function formatWatchList(watches, { paused = false } = {}) {
  if (!watches.length) return '🔔 You are not watching anything yet. Say: "notify me when new threads come in SEO, guest outreach and content writing".';
  return ['🔔 <b>Your alerts</b>' + (paused ? ' · PAUSED (say "resume alerts")' : ' · checked every 15 minutes'), '', ...watches.map((w) => `${w.on === false ? '⏸' : '•'} <b>${h(w.label)}</b>: ${h(w.terms.join(', '))}`), '', 'Change them in plain words: "also watch link building" · "stop watching content writing" · "pause alerts"'].join('\n');
}
