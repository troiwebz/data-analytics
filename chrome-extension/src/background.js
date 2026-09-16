// MV3 service worker: the watcher, the matcher, and the hand that posts.
//
// Two alarms drive everything (setTimeout does not survive worker sleep):
//   poll-feed      — every cfg.pollMinutes (+ jitter): new threads → score →
//                    draft → Apps Script → Telegram. Strong leads get STAGED:
//                    thread opened in a background tab, reply typed in, NOT sent.
//   poll-approvals — every minute: anything you tapped 🚀 on gets posted —
//                    a staged tab just clicks Submit; otherwise full open+type+post.
//
// Nothing is ever posted without a 🚀 tap from Telegram.

import { getConfig, setConfig, migrateConfig, DEFAULT_CONFIG } from './config.js';
import { fetchFeed } from './feed.js';
import { fetchListing, fetchListingPages, forumUrlFromFeed, withListing } from './listing.js';
import { matchLead } from './matcher.js';
import { sampleThread, unscored } from './sample.js';
import { renderReply, renderDm, renderDmTitle } from './templates.js';
import { lintDraft } from './compliance.js';
import { buildCard, setCardZone } from './telegram-card.js';
import { pushLeads, fetchApproved, reportResult, fetchRecent } from './sync.js';
import * as telegram from './telegram.js';
import { fetchConversations, matchLead as matchConversation } from './messages.js';
import { writeSpecifics, aiStatus, saveKey, clearKey, setBudget, setModel, setEnabled, testCall,
         revealKey, factoryReset, addCredits, resetSpend } from './claude.js';
import {
  getSeen, markSeen, clearSeen, isFirstRun, recordLeads, getLeads, updateLead, mergeLeads, updateReplyCounts,
  checkRateLimit, recordPost, unrecordPost, checkDmLimit, recordDm, unrecordDm, log,
  getStaged, setStaged, removeStagedByTab, dedupeLeads
} from './store.js';

const FEED_ALARM = 'poll-feed';
const APPROVAL_ALARM = 'poll-approvals';
const UPDATE_ALARM = 'check-update';
const PM_ALARM = 'sync-pms';

// ---------------------------------------------------------------- sound

/**
 * A short sound when new threads land, so the machine can sit in the
 * background. The worker cannot play audio itself - no Audio, no DOM - so an
 * offscreen document does it. One is enough; it is created on the first alert
 * and reused, and creating a second throws, which is why the race is caught.
 */
let offscreenReady = null;
async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('This Chrome is too old for extension audio.');
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play a short sound when a new freelancer thread is found.'
    }).catch((e) => { if (!/single offscreen/i.test(e.message)) throw e; })
      .finally(() => { offscreenReady = null; });
  }
  await offscreenReady;
}

/** Never throws: a missing sound must not cost a lead. */
export async function playSound(cfg, which) {
  if (!cfg.soundEnabled) return { skipped: 'off' };
  const sound = which || cfg.sound || 'chime';
  if (sound === 'none') return { skipped: 'silent' };
  try {
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({ target: 'offscreen-audio', sound, volume: cfg.soundVolume });
    if (r && r.ok === false) await log(`sound failed: ${r.error}`, 'error');
    return r || { ok: true };
  } catch (e) {
    await log(`sound failed: ${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
}

/**
 * Reconcile against your actual BHW direct-message list.
 *
 * The local record only knows about PMs it watched you send. This reads the
 * real list and marks anything already sent, including from your phone, from
 * another machine, or before this extension existed. Read-only: it opens
 * nothing and sends nothing.
 */
export async function syncSentPms({ pages = 2 } = {}) {
  const conversations = await fetchConversations(pages);
  const leads = await getLeads();
  let marked = 0, known = 0;

  for (const lead of leads) {
    const hit = matchConversation(lead, conversations);
    if (!hit) continue;
    if (hit.sent) {
      if (lead.pmSent) continue;                       // already known, nothing to do
      await updateLead(lead.threadId, {
        pmSent: true, pmSentAt: hit.at || new Date().toISOString(), pmFrom: 'your BHW message list'
      });
      await recordDm();
      marked++;
    } else if (!lead.priorContact) {
      await updateLead(lead.threadId, { priorContact: hit.at ? hit.at.slice(0, 10) : 'earlier' });
      known++;
    }
  }
  await log(`checked ${conversations.length} conversation(s): ${marked} already sent, ${known} previously contacted`);
  return { conversations: conversations.length, marked, known };
}

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  const migrated = await migrateConfig();
  const cfg = await getConfig();
  await setConfig(cfg);
  await scheduleAlarms(cfg);
  await log(details.reason === 'install' ? 'installed' : `reloaded (v${chrome.runtime.getManifest().version}${migrated ? ', settings upgraded' : ''})`);
  // Drafts are written once and stored, so a template change reaches nothing
  // already in the database. Re-render when the wording has moved, rather than
  // waiting for someone to notice and press a button. No network, no cost.
  await refreshIfTemplatesChanged(cfg);
  // Rows duplicated before leads were keyed by thread id.
  const d = await dedupeLeads().catch(() => null);
  if (d?.removed) await log(`removed ${d.removed} duplicate row(s)`);
});

/** A cheap fingerprint of everything that decides how a draft reads. */
const templateStamp = (cfg) => {
  const src = JSON.stringify([cfg.templates, cfg.dmTemplates, cfg.offers, cfg.dmTitle, cfg.specifics]);
  let h = 2166136261 >>> 0;
  for (const ch of src) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
};

async function refreshIfTemplatesChanged(cfg) {
  try {
    const stamp = templateStamp(cfg);
    const { draftStamp } = await chrome.storage.local.get('draftStamp');
    if (draftStamp === stamp) return;
    const r = await rebuildDrafts({ withAi: false });
    await chrome.storage.local.set({ draftStamp: stamp });
    if (r.updated) await log(`templates changed: ${r.updated} stored draft(s) brought up to date`);
  } catch (e) {
    await log(`could not refresh drafts: ${e.message}`, 'error');
  }
}
chrome.runtime.onStartup.addListener(async () => scheduleAlarms(await getConfig()));

// Toolbar icon opens the dashboard as a full tab (focused if already open).
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) { chrome.tabs.update(tab.id, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); }
  else chrome.tabs.create({ url });
});

// A staged tab the user closes by hand is simply forgotten.
chrome.tabs.onRemoved.addListener((tabId) => removeStagedByTab(tabId));

export async function scheduleAlarms(cfg) {
  await chrome.alarms.clear(FEED_ALARM);
  await chrome.alarms.clear(APPROVAL_ALARM);
  if (!cfg.enabled) return;
  chrome.alarms.create(FEED_ALARM, { periodInMinutes: Math.max(1, cfg.pollMinutes), delayInMinutes: 0.1 });
  chrome.alarms.create(APPROVAL_ALARM, { periodInMinutes: Math.max(1, cfg.approvalPollMinutes) });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
  // Hourly is plenty: it is a safety net for PMs sent elsewhere, and the
  // button on the dashboard covers wanting it now.
  chrome.alarms.create(PM_ALARM, { periodInMinutes: 60, delayInMinutes: 2 });
}

/**
 * Unpacked extensions are served straight from the folder on disk, so after a
 * `git pull` the files are new but the running code is old. Compare the
 * manifest on disk with the one we started with and reload ourselves.
 * Settings and the local database live in chrome.storage and survive it.
 */
async function checkForUpdate() {
  const running = chrome.runtime.getManifest().version;
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = (await res.json()).version;
    if (onDisk && onDisk !== running) {
      await log(`new version on disk (${running} → ${onDisk}) — reloading`);
      chrome.runtime.reload();
      return { reloading: true, version: onDisk };
    }
    return { reloading: false, version: running };
  } catch (e) {
    return { reloading: false, version: running, error: `could not read the folder: ${e.message}` };
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === FEED_ALARM) {
      const cfg = await getConfig();
      // Jitter so the fetch doesn't land on the same second every cycle.
      await new Promise((r) => setTimeout(r, Math.random() * (cfg.jitterSeconds || 0) * 1000));
      await pollFeed();
    }
    if (alarm.name === APPROVAL_ALARM) { await expireStaged(); await pollApprovals(); }
    if (alarm.name === UPDATE_ALARM) await checkForUpdate();
    if (alarm.name === PM_ALARM) await syncSentPms().catch((e) => log(`PM check: ${e.message}`, 'error'));
  } catch (e) {
    await log(`${alarm.name}: ${e.message}`, 'error');
  }
});

// ------------------------------------------------------------------- feed

/**
 * BHW's direct-message page with the recipient filled in.
 *
 * `?to=` and nothing else, because that is the exact URL a person gets from
 * clicking "Start conversation" on a member's profile. A `&title=` on the end
 * is not something a human ever produces, so it stands out in the address bar
 * and in whatever the forum logs. The subject is typed into the form by the
 * content script instead, which leaves no trace in the URL.
 *
 * Form-encoded, so spaces are '+', not %20:
 *   https://www.blackhatworld.com/direct-messages/add?to=digital+value
 */
export function dmUrl(author) {
  const form = (v) => encodeURIComponent(v || '').replace(/%20/g, '+');
  return 'https://www.blackhatworld.com/direct-messages/add?to=' + form(author);
}

/**
 * Claude-written bullets for a batch of leads, keyed by threadId.
 * Never throws and never blocks a poll: any failure returns {} and the reply
 * falls back to the built-in specifics rules.
 */
export async function specificsFor(leads, cfg) {
  if (!cfg.aiSpecifics || !leads.length) return {};
  const payload = leads.map((l) => ({
    threadId: String(l.threadId),
    title: l.title,
    snippet: String(l.snippet || '').slice(0, 800),
    category: l.category || ''
  }));
  const { specifics, note } = await writeSpecifics(payload, cfg);
  const n = Object.keys(specifics).length;
  if (n) await log(`Claude wrote specifics for ${n}/${leads.length} lead(s)`);
  else if (note) await log(`Claude stood down (${note}); using built-in rules`);
  return specifics;
}

/**
 * Re-render every stored draft from the current templates.
 *
 * A lead keeps the text it was written with, so changing a template changes
 * nothing already in the database until this runs. That is why an old sign-off
 * kept appearing long after it had been deleted from the code, and why this now
 * runs by itself whenever the templates change, not only on a button.
 *
 * withAi also fills in Claude lines for leads found before a key was added.
 */
export async function rebuildDrafts({ withAi = false } = {}) {
  const cfg = await getConfig();
  const leads = await getLeads();
  const has = (l) => l.aiSpecifics?.tips?.length || l.aiSpecifics?.length;
  const missing = leads.filter((l) => !has(l) && !['POSTED', 'SKIPPED'].includes(l.status));

  let aiCount = 0;
  if (withAi && cfg.aiSpecifics && missing.length) {
    for (let i = 0; i < missing.length; i += 8) {
      const fresh = await specificsFor(missing.slice(i, i + 8), cfg);
      for (const [id, parts] of Object.entries(fresh)) {
        await updateLead(id, { aiSpecifics: parts });
        const lead = leads.find((l) => String(l.threadId) === String(id));
        if (lead) lead.aiSpecifics = parts;
        aiCount++;
      }
      if (!Object.keys(fresh).length) break;        // stood down; stop asking
    }
  }

  let n = 0;
  for (const l of leads) {
    const draft = renderReply(l, cfg);
    const dm = renderDm(l, cfg);
    if (draft === l.draft && dm === l.dm) continue;
    const dmTitle = renderDmTitle(l, cfg);
    const patch = {
      draft, dm, dmTitle, dmUrl: dmUrl(l.author),
      lint: lintDraft(draft, cfg.compliance), dmLint: lintDraft(dm, cfg.compliance)
    };
    patch.card = buildCard({ ...l, ...patch });
    await updateLead(l.threadId, patch);
    n++;
  }
  if (n || aiCount) await log(`rebuilt ${n} draft(s)` + (aiCount ? `, ${aiCount} with fresh Claude lines` : ''));
  return { ok: true, updated: n, ai: aiCount, pending: missing.length - aiCount };
}

/** Everything derived from a matched thread: public reply, PM draft, lint, Telegram card. */
export function enrich(m, cfg, status, aiSpecifics) {
  setCardZone(cfg);                    // the card's times use the same zone
  // Claude returns { tips, question, offer }; older rows hold a bare array.
  if (aiSpecifics?.tips?.length || aiSpecifics?.length) m = { ...m, aiSpecifics };
  const draft = renderReply(m, cfg);
  const dm = renderDm(m, cfg);
  const dmTitle = renderDmTitle(m, cfg);
  const lead = {
    ...m, draft, dm, dmTitle, dmUrl: dmUrl(m.author),
    lint: lintDraft(draft, cfg.compliance),
    dmLint: lintDraft(dm, cfg.compliance),
    status, foundAt: new Date().toISOString()
  };
  lead.card = buildCard(lead);
  return lead;
}

export async function pollFeed() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };
  await chrome.storage.local.set({ lastPollAt: Date.now() });

  const items = await fetchFeed(cfg.feedUrl);
  const seen = await getSeen();
  const fresh = items.filter((i) => !seen[i.threadId]);

  // First run: nothing goes to Telegram, but the last backfillHours of threads
  // are recorded in the Sheet so the database starts with history, not empty.
  if (await isFirstRun()) {
    const cutoff = Date.now() - (cfg.backfillHours || 0) * 3600000;
    const recent = items.filter((i) => new Date(i.postedAt).getTime() >= cutoff);
    const listing = recent.length ? await fetchListing(forumUrlFromFeed(cfg.feedUrl)) : {};
    const backfill = recent.map((raw) => {
      const item = withListing(raw, listing[raw.threadId]);
      const m = matchLead(item, cfg) || { ...item, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 };
      return enrich(m, cfg, 'BACKFILL');
    });
    await markSeen(items.map((i) => i.threadId));
    if (backfill.length) {
      await recordLeads(backfill);
      try { await pushLeads(cfg, backfill, { backfill: true }); }
      catch (e) { await log(`backfill push failed: ${e.message}`, 'error'); }
    }
    await log(`first run: ${items.length} threads seen, ${backfill.length} from the last ${cfg.backfillHours}h recorded`);
    return { seeded: items.length, backfilled: backfill.length };
  }
  // Reply counts move fast on a job board — refresh them for everything we
  // already know about on every poll, not just for new threads.
  const listing = await fetchListing(forumUrlFromFeed(cfg.feedUrl));
  await updateReplyCounts(Object.fromEntries(
    Object.entries(listing).map(([id, v]) => [id, v.replyCount]).filter(([, c]) => c != null)));

  if (!fresh.length) return { new: 0, matched: 0 };

  // Every new thread goes through. matchLead only decides category/score;
  // an unmatched thread still gets sent with score 0 and a generic draft.
  const matched = fresh
    .map((raw) => {
      const item = withListing(raw, listing[raw.threadId]);
      return matchLead(item, cfg) || { ...item, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 };
    })
    .filter((m) => m.score >= cfg.notifyScore);

  // One batched request for the whole poll, so the instructions are paid for
  // once rather than once per lead. Falls back to the built-in rules.
  const ai = await specificsFor(matched, cfg);
  const leads = matched.map((m) => enrich(m, cfg, 'SENT', ai[m.threadId]));
  await markSeen(fresh.map((i) => i.threadId));

  if (!leads.length) return { new: fresh.length, matched: 0 };

  await recordLeads(leads);

  // Telegram, straight from here: every new thread goes to your phone as it is
  // found, no Apps Script in the way. A failure is logged and nothing else -
  // the lead is already saved, so it is never lost to a network blip.
  try {
    const t = await telegram.sendLeads(leads, cfg);
    if (t.error) await log(`Telegram: ${t.sent}/${leads.length} lead(s), ${t.parts} message(s). Failed - ${t.error}`, 'error');
    else if (t.sent) await log(`Telegram: ${t.sent} lead(s) as ${t.parts} message(s)`);
  } catch (e) { await log(`Telegram failed: ${e.message}`, 'error'); }

  if (cfg.webhookUrl) {
    try {
      const r = await pushLeads(cfg, leads);
      await log(`${fresh.length} new → ${r.sent ?? leads.length} sent, ${r.expired ?? 0} expired, ${r.held ?? 0} held`);
    } catch (e) {
      await log(`Sheet push failed, leads kept locally: ${e.message}`, 'error');
    }
  } else {
    await log(`${fresh.length} new thread(s), ${leads.length} drafted`);
  }

  const hot = leads.filter((l) => l.score >= cfg.stageScore).sort((a, b) => b.score - a.score);

  // One banner and one sound per check, not one per thread: five at once is a
  // single alert. A hot lead gets the louder sound and says so, so it is
  // distinguishable without looking at the screen.
  await playSound(cfg, hot.length ? cfg.soundHot : cfg.sound);

  const best = hot[0] || [...leads].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const what = leads.length === 1 ? '1 new HAF thread' : `${leads.length} new HAF threads`;
  await notify(hot.length ? `🔥 ${what} · ${hot[0].score} pts` : what,
               best.title, { hot: hot.length > 0 });

  if (hot.length) await stageLeads(hot, cfg);
  return { new: fresh.length, matched: leads.length, staged: hot.length };
}

/**
 * Walk the forum listing pages and record every thread in the window into the
 * database. Reaches threads the RSS feed has long dropped. Listing rows carry
 * no post body, so these are matched on the title alone and marked
 * bodyless — the score is a floor, not a verdict. Nothing is sent to Telegram.
 */
/**
 * Read back far enough to cover whole days, rather than a page count nobody
 * can translate into time. A busy day is 40 threads and a quiet one is 10, so
 * guessing "10 pages" gives an average computed over a day and a half - which
 * is the number that cannot mean anything.
 *
 * Pages are walked in widening steps until the oldest thread seen is older
 * than the window, or the forum runs out.
 */
export async function fillDays(days = 7) {
  const cfg = await getConfig();
  const from = Date.now() - days * 86400000;
  const url = forumUrlFromFeed(cfg.feedUrl);

  let pages = 0, oldest = Date.now(), listing = {};
  for (const step of [8, 8, 12, 12, 20, 20]) {
    pages += step;
    listing = await fetchListingPages(url, pages, {
      onPage: (page, found, total) => log(`  page ${page}: ${found} thread(s), ${total} so far`)
    });
    const times = Object.values(listing)
      .map((r) => (r.startedAt ? new Date(r.startedAt).getTime() : NaN)).filter(isFinite);
    if (!times.length) break;
    oldest = Math.min(...times);
    if (oldest <= from) break;                     // the window is covered
    if (Object.keys(listing).length < pages * 5) break;   // the forum ran out
  }

  const r = await deepBackfill({ pages, sinceDays: days });
  const covered = Math.max(1, Math.round((Date.now() - Math.max(oldest, from)) / 86400000));
  await log(`filled ${covered} day(s) from ${pages} page(s): ${r.backfilled} thread(s) recorded`);
  return { ...r, pages, days: covered, reachedBack: new Date(oldest).toISOString() };
}

export async function deepBackfill({ pages = 5, sinceDays = 0, fromDate = '', toDate = '' } = {}) {
  const cfg = await getConfig();
  const from = fromDate ? new Date(fromDate).getTime()
             : sinceDays ? Date.now() - sinceDays * 86400000 : -Infinity;
  const to = toDate ? new Date(toDate).getTime() + 86400000 : Infinity;   // inclusive day

  await log(`deep backfill: reading up to ${pages} listing page(s)…`);
  const listing = await fetchListingPages(forumUrlFromFeed(cfg.feedUrl), pages, {
    onPage: (page, found, total) => log(`  page ${page}: ${found} thread(s), ${total} so far`)
  });

  const seen = await getSeen();
  const rows = Object.values(listing).filter((r) => {
    if (!r.threadId || !r.url || seen[r.threadId]) return false;
    const t = r.startedAt ? new Date(r.startedAt).getTime() : NaN;
    return isFinite(t) ? t >= from && t <= to : from === -Infinity;
  });

  const leads = rows.map((r) => {
    const item = {
      threadId: r.threadId, url: r.url, title: r.title, author: r.author,
      // Never invent a start time. Stamping "now" on a thread whose date could
      // not be read put it on today at the current minute, which is how a
      // quiet forum came to look like 27 threads a day with a spike at 11pm.
      snippet: '', postedAt: r.startedAt || null,
      lastActivityAt: r.lastActivityAt, postedAtSource: r.startedAt ? 'listing' : 'unknown',
      replyCount: r.replyCount
    };
    const m = matchLead(item, cfg) || { ...item, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 };
    return { ...enrich(m, cfg, 'BACKFILL'), bodyless: true };
  });

  await markSeen(rows.map((r) => r.threadId));
  if (leads.length) {
    await recordLeads(leads);
    try { await pushLeads(cfg, leads, { backfill: true }); }
    catch (e) { await log(`deep backfill push failed, kept locally: ${e.message}`, 'error'); }
  }
  await log(`deep backfill: ${leads.length} thread(s) recorded of ${Object.keys(listing).length} seen`);
  return { ok: true, scanned: Object.keys(listing).length, backfilled: leads.length };
}

// ---------------------------------------------------------------- staging

async function stageLeads(leads, cfg) {
  const staged = await getStaged();
  let room = cfg.maxStagedTabs - Object.keys(staged).length;
  for (const lead of leads) {
    if (room <= 0) break;
    if (staged[lead.threadId]) continue;
    const r = await runInThread(lead, 'stage', { keepTab: true });
    if (r.ok) {
      await setStaged(lead.threadId, { tabId: r.tabId, at: Date.now(), title: lead.title });
      await updateLead(lead.threadId, { staged: true });
      room--;
    } else {
      await log(`stage failed for "${lead.title}": ${r.error}`, 'error');
    }
  }
}

async function expireStaged() {
  const cfg = await getConfig();
  const staged = await getStaged();
  const cutoff = Date.now() - cfg.stageTtlMinutes * 60000;
  for (const [threadId, e] of Object.entries(staged)) {
    if (e.at < cutoff) {
      chrome.tabs.remove(e.tabId).catch(() => {});
      await setStaged(threadId, null);
      await updateLead(threadId, { staged: false });
    }
  }
}

// -------------------------------------------------------------- approvals

export async function pollApprovals() {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.autoPost || !cfg.webhookUrl) return;

  const approved = await fetchApproved(cfg);
  if (!approved.length) return;

  const lead = approved[0];                          // one per tick; spacing is enforced anyway
  const gate = await checkRateLimit(cfg);
  if (!gate.ok) { await log(`holding "${lead.title}" — ${gate.reason}`); return; }
  await postLead(lead, cfg);
}

/**
 * Post one lead: fire the staged tab if there is one (and the text wasn't
 * edited since), otherwise open + type + post. Then record the outcome
 * locally, in the Sheet, and on Telegram.
 */
export async function postLead(lead, cfg, { edited = false } = {}) {
  const staged = (await getStaged())[lead.threadId];
  let result;
  if (staged && !edited) {
    await log(`firing staged reply → "${lead.title}"`);
    result = await runInThread(lead, 'submit', { tabId: staged.tabId });
    await setStaged(lead.threadId, null);
    if (!result.ok) {                                // tab died or editor emptied — fall back
      await log(`staged submit failed (${result.error}); doing a full post`);
      result = await runInThread(lead, 'full');
    }
  } else {
    if (staged) { chrome.tabs.remove(staged.tabId).catch(() => {}); await setStaged(lead.threadId, null); }
    await log(`posting → "${lead.title}"`);
    result = await runInThread(lead, 'full');
  }

  if (result.ok) {
    await recordPost();
    await updateLead(lead.threadId, { status: 'POSTED', postUrl: result.postUrl, draft: lead.draft, staged: false, error: '' });
    await reportResult(cfg, lead.threadId, 'POSTED', result.postUrl || '').catch(() => {});
  } else {
    await updateLead(lead.threadId, { status: 'FAILED', error: result.error, staged: false });
    await reportResult(cfg, lead.threadId, 'FAILED', result.error || 'unknown').catch(() => {});
    await log(`post failed: ${result.error}`, 'error');
    notify('HAF post FAILED', result.error || lead.title);
  }
  return result;
}

/**
 * Open the DM compose page and fill it in. mode 'send' also submits.
 * Unsolicited PMs are the thing BHW moderators actually act on, so this is
 * capped and spaced separately from posting, and never runs unprompted.
 */
export async function sendDm(lead, cfg, { mode = 'send' } = {}) {
  const body = lead.dm || renderDm(lead, cfg);
  const title = lead.dmTitle || renderDmTitle(lead, cfg);
  let tab;
  try {
    tab = await chrome.tabs.create({ url: dmUrl(lead.author, title), active: mode !== 'send' });
    await waitForTabLoad(tab.id);
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 2000));

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (dm, m, id) => { globalThis.__HAF_DM__ = dm; globalThis.__HAF_DM_MODE__ = m; globalThis.__HAF_THREAD_ID__ = id; },
      args: [{ author: lead.author, title, body }, mode, String(lead.threadId)]
    });

    const pending = new Promise((resolve) => {
      const timer = setTimeout(() => { done(); resolve({ ok: false, error: 'DM script timed out' }); }, 45000);
      const onMsg = (msg) => {
        if (msg?.type === 'haf-dm-result' && String(msg.threadId) === String(lead.threadId)) { done(); resolve(msg.result); }
      };
      const done = () => { clearTimeout(timer); chrome.runtime.onMessage.removeListener(onMsg); };
      chrome.runtime.onMessage.addListener(onMsg);
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/selectors.js', 'src/content-lib.js', 'src/content-dm.js'] });
    const result = await pending;

    if (result.ok && result.sent) {
      await recordDm();
      await updateLead(lead.threadId, { pmSent: true, pmSentAt: new Date().toISOString(), dm: body, pmError: '' });
      await log(`DM sent → ${lead.author}`);
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 3000);
    } else if (!result.ok) {
      await updateLead(lead.threadId, { pmError: result.error });
      await log(`DM failed (${lead.author}): ${result.error}`, 'error');
      // Leave the tab open on failure so it can be finished by hand.
      chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    }
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// --------------------------------------------------------------- posting

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('tab load timeout')); }, timeoutMs);
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function waitForResult(threadId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: 'content script timed out' }); }, timeoutMs);
    const onMsg = (msg) => {
      if (msg?.type === 'haf-post-result' && String(msg.threadId) === String(threadId)) { cleanup(); resolve(msg.result); }
    };
    const cleanup = () => { clearTimeout(timer); chrome.runtime.onMessage.removeListener(onMsg); };
    chrome.runtime.onMessage.addListener(onMsg);
  });
}

/**
 * Run the content script in a thread page.
 *   mode 'full'   → new tab, insert, submit, close
 *   mode 'stage'  → new tab, insert, leave open (keepTab)
 *   mode 'submit' → existing tab (opts.tabId), submit, close
 */
export async function runInThread(lead, mode, opts = {}) {
  let tabId = opts.tabId;
  let opened = false;
  try {
    if (!tabId) {
      const tab = await chrome.tabs.create({ url: lead.url, active: false });
      tabId = tab.id; opened = true;
      await waitForTabLoad(tabId);
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));   // human-ish pause
    } else {
      try { await chrome.tabs.get(tabId); } catch { return { ok: false, error: 'staged tab is gone' }; }
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (draft, m, id) => { globalThis.__HAF_DRAFT__ = draft; globalThis.__HAF_MODE__ = m; globalThis.__HAF_THREAD_ID__ = id; },
      args: [lead.draft || '', mode, String(lead.threadId)]
    });
    const pending = waitForResult(lead.threadId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/selectors.js', 'src/content-lib.js', 'src/content-post.js'] });
    const result = await pending;
    return { ...result, tabId };
  } catch (e) {
    return { ok: false, error: e.message, tabId };
  } finally {
    const keep = opts.keepTab && mode === 'stage';
    if (tabId && !keep) setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), opened ? 4000 : 2500);
  }
}

// ---------------------------------------------------------------- helpers

/**
 * A real macOS notification. Chrome hands chrome.notifications straight to the
 * system, so these are Notification Centre banners: they stack, they persist,
 * and they arrive over other apps and full screen.
 *
 * One caveat worth knowing, because it looks like a bug: macOS can silence
 * them entirely at System Settings > Notifications > Google Chrome, and while
 * Do Not Disturb or any Focus is on. Nothing in the extension can override
 * that, which is what the test button in Settings is for.
 *
 * `hot` keeps the banner on screen until it is dismissed, rather than letting
 * a good lead slide away after a few seconds.
 */
export async function notify(title, message, { hot = false, id = 'haf-leads' } = {}) {
  return new Promise((resolve) => {
    try {
      chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('src/icons/icon128.png'),
        title,
        message: String(message || '').slice(0, 180),
        priority: hot ? 2 : 1,
        requireInteraction: hot,
        buttons: [{ title: 'Open the drafts' }]
      }, (created) => {
        const err = chrome.runtime.lastError;
        if (err) { log(`notification blocked: ${err.message}`, 'error'); resolve({ ok: false, error: err.message }); }
        else resolve({ ok: true, id: created });
      });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

async function openDashboard() {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) { chrome.tabs.update(tab.id, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); }
  else chrome.tabs.create({ url });
}

// The banner and its button both go to the drafts: that is the only thing
// anyone wants from it.
chrome.notifications.onClicked.addListener((id) => { chrome.notifications.clear(id); openDashboard(); });
chrome.notifications.onButtonClicked.addListener((id) => { chrome.notifications.clear(id); openDashboard(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.cmd) return;
  (async () => {
    switch (msg.cmd) {
      case 'poll-now':      sendResponse(await pollFeed().catch((e) => ({ error: e.message }))); break;
      case 'approvals-now': sendResponse(await pollApprovals().then(() => ({ ok: true })).catch((e) => ({ error: e.message }))); break;
      case 'reschedule':    await scheduleAlarms(await getConfig()); sendResponse({ ok: true }); break;
      case 'staged':        sendResponse(await getStaged()); break;
      case 'backfill':      await clearSeen(); sendResponse(await pollFeed().catch((e) => ({ error: e.message }))); break;
      case 'post-direct': {                          // 🚀 from the dashboard, no Telegram needed
        const cfg = await getConfig();
        const gate = await checkRateLimit(cfg);
        if (!gate.ok) { sendResponse({ ok: false, error: gate.reason }); break; }
        sendResponse(await postLead(msg.lead, cfg, { edited: !!msg.edited }));
        break;
      }
      case 'mark': {                                 // ✅ posted by hand / ⏭ skip, from the dashboard
        const cfg = await getConfig();
        const was = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        if (msg.status === 'POSTED' && was?.status !== 'POSTED') await recordPost();
        const staged = (await getStaged())[msg.threadId];
        if (staged) { chrome.tabs.remove(staged.tabId).catch(() => {}); await setStaged(msg.threadId, null); }
        await updateLead(msg.threadId, { status: msg.status, staged: false, error: '' });
        if (cfg.webhookUrl) await reportResult(cfg, msg.threadId, msg.status, msg.detail || '').catch((e) => log(`sheet update failed: ${e.message}`, 'error'));
        sendResponse({ ok: true });
        break;
      }
      case 'deep-backfill': {                        // walk N listing pages into the database
        sendResponse(await deepBackfill(msg.opts || {}).catch((e) => ({ error: e.message })));
        break;
      }
      case 'fill-days': {                            // cover N whole days, however many pages that takes
        sendResponse(await fillDays(msg.days || 7).catch((e) => ({ error: e.message })));
        break;
      }
      case 'regen': sendResponse(await rebuildDrafts({ withAi: true })); break;
      case 'fill-thread': {                          // 📝 open the thread with the reply typed in
        const cfg = await getConfig();
        const staged = (await getStaged())[msg.lead.threadId];
        if (staged) { chrome.tabs.remove(staged.tabId).catch(() => {}); await setStaged(msg.lead.threadId, null); }
        const r = await runInThread(msg.lead, 'stage', { keepTab: true });
        if (r.ok && r.tabId) {
          await setStaged(msg.lead.threadId, { tabId: r.tabId, at: Date.now(), title: msg.lead.title });
          await updateLead(msg.lead.threadId, { staged: true });
          chrome.tabs.update(r.tabId, { active: true }).catch(() => {});
        }
        sendResponse(r);
        break;
      }
      case 'send-dm': {                              // ✉️ Send PM now, or just fill the page
        const cfg = await getConfig();
        const mode = msg.mode || 'send';
        // Only an actual send is rate limited. Opening the page with the text
        // typed in sends nothing to the forum, so there is nothing to space
        // out, and blocking it only stops you preparing the next one.
        if (mode === 'send') {
          const gate = await checkDmLimit(cfg);
          if (!gate.ok) { sendResponse({ ok: false, error: gate.reason }); break; }
        }
        sendResponse(await sendDm(msg.lead, cfg, { mode }));
        break;
      }
      case 'mark-pm': {                              // ✅ sent, or copied to send by hand
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        await updateLead(msg.threadId, { pmSent: true, pmSentAt: new Date().toISOString() });
        // However it left, it counts against the daily cap. Marking one that
        // was already marked must not count it twice.
        if (!lead?.pmSent) await recordDm();
        sendResponse({ ok: true });
        break;
      }
      case 'unmark': {                               // ↩︎ a copy that was not meant as a post
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        await updateLead(msg.threadId, { status: 'SENT', error: '', postUrl: '' });
        if (lead?.status === 'POSTED') await unrecordPost();
        sendResponse({ ok: true });
        break;
      }
      case 'unmark-pm': {
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        await updateLead(msg.threadId, { pmSent: false, pmSentAt: '', pmError: '' });
        if (lead?.pmSent) await unrecordDm();
        sendResponse({ ok: true });
        break;
      }
      case 'sync': {                                 // pull the Sheet into the local database
        const cfg = await getConfig();
        sendResponse(await fetchRecent(cfg).then(async (rows) => ({ ok: true, merged: await mergeLeads(rows) }))
          .catch((e) => ({ error: /unknown action/.test(e.message) ? 'Update the Apps Script code to enable Sync (needs the "recent" action).' : e.message })));
        break;
      }
      case 'defaults':      sendResponse(DEFAULT_CONFIG); break;
      // Claude lives in the extension: key, spend and limits are all local.
      case 'ai-status':   sendResponse(await aiStatus()); break;
      case 'ai-save-key': sendResponse(await saveKey(msg.key).catch((e) => ({ error: e.message }))); break;
      case 'ai-clear-key':sendResponse(await clearKey()); break;
      case 'ai-budget':   sendResponse(await setBudget(msg.budget).catch((e) => ({ error: e.message }))); break;
      case 'ai-model':    sendResponse(await setModel(msg.model).catch((e) => ({ error: e.message }))); break;
      case 'ai-enabled':  sendResponse(await setEnabled(msg.on)); break;
      case 'ai-test':     sendResponse(await testCall(await getConfig()).catch((e) => ({ ok: false, error: e.message }))); break;
      case 'ai-reveal':   sendResponse({ key: await revealKey() }); break;
      case 'ai-credits':  sendResponse(await addCredits(msg.amount).catch((e) => ({ error: e.message }))); break;
      case 'ai-reset-spend': sendResponse(await resetSpend()); break;
      case 'factory-reset': {
        const r = await factoryReset();
        await scheduleAlarms(await getConfig());
        await log(`settings and database cleared; Claude key ${r.keyKept ? 'kept' : 'not found'}`);
        sendResponse(r);
        break;
      }
      case 'tg-status':   sendResponse(await telegram.status(await getConfig())); break;
      case 'tg-save-token': {
        try {
          await telegram.setToken(msg.token);
          sendResponse(await telegram.status(await getConfig()));
        } catch (e) { sendResponse({ error: e.message }); }
        break;
      }
      case 'tg-clear-token': await telegram.clearToken(); sendResponse(await telegram.status(await getConfig())); break;
      case 'tg-test':     sendResponse(await telegram.test(await getConfig()).catch((e) => ({ error: e.message }))); break;
      case 'tg-sample': {                            // a full example, end to end
        const cfg = await getConfig();
        // Built through the real pipeline - the same matcher, templates,
        // closes, compliance linter and card a genuine thread goes through -
        // so what arrives is exactly what a real lead will look like, not a
        // hand-written mock that could look right while the real one is broken.
        const sample = sampleThread();
        const m = matchLead(sample, cfg) || unscored(sample);
        const ai = await specificsFor([m], cfg).catch(() => ({}));
        const lead = enrich(m, cfg, 'SENT', ai[m.threadId]);

        const done = [];
        sendResponse(await telegram
          .sendLead(lead, { ...cfg, telegramEnabled: true }, { onPart: (n, e) => !e && done.push(n) })
          .then(() => ({ ok: true, sent: done, usedClaude: !!ai[m.threadId] }))
          .catch((e) => ({ error: e.message, sent: done, usedClaude: !!ai[m.threadId] })));
        break;
      }
      case 'tg-send': {                              // send one lead by hand
        const cfg = await getConfig();
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        if (!lead) { sendResponse({ error: 'lead not found' }); break; }
        const done = [];
        sendResponse(await telegram
          .sendLead(lead, { ...cfg, telegramEnabled: true }, { onPart: (n, e) => !e && done.push(n) })
          .then(() => ({ ok: true, sent: done }))
          .catch((e) => ({ error: e.message, sent: done })));
        break;
      }
      case 'test-alert': {                           // prove the banner and the sound work
        const cfg = await getConfig();
        const sound = await playSound({ ...cfg, soundEnabled: true }, cfg.soundHot);
        const banner = await notify('🔥 2 new HAF threads · 14 pts',
          'Looking for Bulk GMB Listings', { hot: true, id: 'haf-test' });
        sendResponse({ sound, banner });
        break;
      }
      case 'play-sound': {                           // the Play button in Settings
        const cfg = await getConfig();
        sendResponse(await playSound({ ...cfg, soundEnabled: true }, msg.sound));
        break;
      }
      case 'sync-pms':      sendResponse(await syncSentPms({ pages: msg.pages || 3 }).catch((e) => ({ error: e.message }))); break;
      case 'next-check': {
        // chrome.alarms holds the real schedule, so ask it rather than adding
        // an interval to a remembered time and drifting away from the truth.
        const cfg = await getConfig();
        const alarm = await chrome.alarms.get(FEED_ALARM).catch(() => null);
        const { lastPollAt } = await chrome.storage.local.get('lastPollAt');
        sendResponse({
          enabled: !!cfg.enabled,
          at: alarm?.scheduledTime || 0,
          lastAt: lastPollAt || 0,
          everyMinutes: cfg.pollMinutes,
          jitterSeconds: cfg.jitterSeconds || 0
        });
        break;
      }
      case 'check-update':  sendResponse(await checkForUpdate()); break;
      default:              sendResponse({ error: 'unknown command' });
    }
  })();
  return true;
});
