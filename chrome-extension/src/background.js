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

import { getConfig, setConfig, migrateConfig, adoptNewTemplates, DEFAULT_CONFIG } from './config.js';
import { fetchFeed } from './feed.js';
import { fetchListing, fetchListingPages, forumUrlFromFeed, withListing } from './listing.js';
import { fetchThreads } from './thread.js';
import { rivalBrief, upgradeReason, sourceOf } from './rivals.js';
import { matchLead } from './matcher.js';
import { sampleThread, unscored } from './sample.js';
import { renderReply, renderDm, renderDmTitle, plain } from './templates.js';
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
const TAP_ALARM = 'telegram-taps';

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
  // New wording shipped with the code is taken up before anything reads the
  // config, and before setConfig writes it back - otherwise that write would
  // freeze the old wording in again, which is the whole bug this fixes.
  const adopt = await adoptNewTemplates().catch(() => ({}));
  let cfg = await getConfig();
  await setConfig(cfg);
  await scheduleAlarms(cfg);
  await log(details.reason === 'install' ? 'installed' : `reloaded (v${chrome.runtime.getManifest().version}${migrated ? ', settings upgraded' : ''})`);
  // Drafts are written once and stored, so a template change reaches nothing
  // already in the database. Re-render when the wording has moved, rather than
  // waiting for someone to notice and press a button. No network, no cost.
  if (adopt.adopted) await log('took up the new draft wording from this update');
  else if (adopt.yours) await log('kept your own template wording; this update shipped different defaults');
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
/**
 * A tab you filled and then closed without posting goes back on the to-do list.
 * Anything else would leave the row claiming a state you never reached.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const staged = await getStaged();
  const entry = Object.entries(staged).find(([, e]) => e.tabId === tabId);
  await removeStagedByTab(tabId);
  if (!entry) return;
  const [threadId] = entry;
  const lead = (await getLeads()).find((l) => String(l.threadId) === String(threadId));
  if (lead?.status === 'FILLED') {
    await updateLead(threadId, { status: 'SENT', staged: false });
    await log(`filled tab closed without posting → back on the to-do list: "${lead.title}"`);
  }
});

/**
 * The reply landing on the thread, for real.
 *
 * "Open filled" types the reply in and leaves the tab for you to read and
 * press Post reply. The row says FILLED until then, and turns POSTED here -
 * when the content script sees the post actually appear, or when the page
 * navigates to the new post (XenForo does one or the other depending on
 * whether the quick reply went through AJAX). Either way the real post link is
 * what gets saved, not a guess.
 */
async function replyLanded(threadId, postUrl, how) {
  const lead = (await getLeads()).find((l) => String(l.threadId) === String(threadId));
  // Only a thread we filled and are holding open can land this way. Anything
  // else - already counted, or a row we never filled - is not ours to mark.
  if (!lead || lead.status !== 'FILLED') return;
  await recordPost();                                     // counts against your daily cap now, not at fill time
  await updateLead(threadId, { status: 'POSTED', postUrl: postUrl || '', staged: false, error: '' });
  await setStaged(threadId, null);                        // the tab stays open; it is yours
  await log(`reply landed on "${lead.title}" (${how})`);
  const cfg = await getConfig();
  if (cfg.webhookUrl) await reportResult(cfg, threadId, 'POSTED', `posted in the tab (${how})`).catch(() => {});
}

// Fallback for a quick reply that reloads the page instead of posting over
// AJAX: XenForo lands you on /threads/<slug>.<id>/post-<n>, which the in-page
// watcher cannot report because it died with the old document.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url || !/\/post-\d+/.test(info.url)) return;
  const staged = await getStaged();
  const entry = Object.entries(staged).find(([, e]) => e.tabId === tabId);
  if (!entry) return;
  // It has to be a post in the thread we filled. Otherwise reading someone
  // else's post permalink in that tab would mark your reply as sent.
  const lead = (await getLeads()).find((l) => String(l.threadId) === String(entry[0]));
  const sameThread = lead?.url && info.url.startsWith(String(lead.url).replace(/\/+$/, ''));
  if (sameThread) await replyLanded(entry[0], info.url, 'page reloaded onto the post');
});

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

  // Your taps on the Telegram buttons. Chrome clamps alarms to 30 seconds, so
  // anything faster than that is the same as 30 seconds - the setting says so.
  await chrome.alarms.clear(TAP_ALARM);
  if (cfg.telegramApprovals) {
    const secs = Math.max(30, Number(cfg.telegramPollSeconds) || 30);
    chrome.alarms.create(TAP_ALARM, { periodInMinutes: secs / 60, delayInMinutes: 0.1 });
  }
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
    if (alarm.name === TAP_ALARM) await pollTaps();
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
/**
 * Read the thread page for each lead and hang the buyer's post and the replies
 * already on it onto the lead.
 *
 * Without this Claude sees a title and, if the feed bothered to carry one, a
 * description - and a lead found on a listing page has neither. "Crypto
 * Runner" came back as multi-chain wallet operations because the title was the
 * entire brief. The replies come along too: they are the other freelancers
 * bidding for the same job, so they show what the job really is and what has
 * already been promised.
 *
 * Never throws and never blocks a poll: a thread that cannot be read just
 * leaves the lead as it was.
 */
export async function withThreads(leads, cfg) {
  if (cfg.readThreads === false || !leads.length) return leads;
  const max = Number(cfg.maxThreadReads) > 0 ? Number(cfg.maxThreadReads) : leads.length;
  const delayMs = Math.max(0, Number(cfg.secondsBetweenThreadReads ?? 2) * 1000);
  const got = await fetchThreads(leads, { max, delayMs }).catch(() => ({}));
  const read = Object.keys(got).length;
  if (read) {
    const rivals = Object.values(got).reduce((n, t) => n + (t.replies?.length || 0), 0);
    await log(`read ${read} thread(s) for the full post${rivals ? ` and ${rivals} reply/replies already on them` : ''}`);
  }
  return leads.map((l) => (got[l.threadId] ? { ...l, ...got[l.threadId] } : l));
}

export async function specificsFor(leads, cfg, { force = false } = {}) {
  if (!cfg.aiSpecifics || !leads.length) return {};

  // Claude is only asked when there is an upgrade in it. A lead whose post and
  // whose competition have not changed since its lines were written would come
  // back with the same answer, so asking again is money for nothing.
  const wanted = force ? leads.map((l) => ({ l, why: 'asked for directly' }))
                       : leads.map((l) => ({ l, why: upgradeReason(l) })).filter((x) => x.why);
  const skipped = leads.length - wanted.length;
  if (!wanted.length) {
    if (skipped) await log(`Claude not needed: ${skipped} draft(s) already answer the thread as it stands`);
    return {};
  }

  const payload = wanted.map(({ l }) => ({
    threadId: String(l.threadId),
    title: l.title,
    snippet: String(l.snippet || '').slice(0, 800),
    body: String(l.body || '').slice(0, 1500),
    replies: (l.replies || []).slice(0, 4).map((r) => ({ text: String(r.text || '').slice(0, 300) })),
    // Worked out locally and free: what the thread already promises, and the
    // part of the buyer's ask nobody has answered.
    rivalBrief: rivalBrief(l.body || l.snippet || '', l.replies || []),
    category: l.category || ''
  }));
  const { specifics, note } = await writeSpecifics(payload, cfg);
  const n = Object.keys(specifics).length;
  if (n) {
    const why = wanted.slice(0, 3).map((x) => x.why).join('; ');
    await log(`Claude wrote specifics for ${n}/${wanted.length} lead(s) (${why})`
      + (skipped ? `; ${skipped} skipped, nothing new to say` : ''));
  } else if (note) await log(`Claude stood down (${note}); using built-in rules`);
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
 * withAi also fills in Claude lines for leads found before a key was added -
 * and redoes the ones written before the thread itself was being read. A draft
 * written from the title alone is the one that answers the wrong job, so it is
 * worth paying for again; a draft that already had the post to work from is
 * left alone.
 */
export async function rebuildDrafts({ withAi = false } = {}) {
  const cfg = await getConfig();
  const leads = await getLeads();
  const open = (l) => !['POSTED', 'SKIPPED'].includes(l.status);
  const candidates = leads.filter(open);

  let aiCount = 0, readCount = 0, missing = [];
  if (withAi && cfg.aiSpecifics && candidates.length) {
    // Read the threads FIRST, then decide whether Claude is worth calling.
    //
    // The order matters. Reading is a request to a forum you are already
    // signed in to and costs nothing; the Claude call is the expensive part,
    // and it is the only thing worth gating. Gating on the stored copy instead
    // would mean a new reply on a thread could never be noticed, because
    // noticing it is exactly what the read is for.
    for (let i = 0; i < candidates.length; i += 8) {
      const batch = await withThreads(candidates.slice(i, i + 8), cfg);
      for (const b of batch) {
        if (!b.body && !b.replies?.length) continue;
        readCount++;
        await updateLead(b.threadId, { body: b.body || '', replies: b.replies || [] });
        const lead = leads.find((l) => String(l.threadId) === String(b.threadId));
        if (lead) { lead.body = b.body; lead.replies = b.replies; }
      }
      // Now the gate, on what the thread actually says today.
      const worth = batch.filter((b) => upgradeReason(b));
      missing = missing.concat(worth);
      if (!worth.length) continue;

      const fresh = await specificsFor(worth, cfg);
      for (const [id, parts] of Object.entries(fresh)) {
        const from = worth.find((b) => String(b.threadId) === String(id));
        const aiFrom = from ? sourceOf(from) : undefined;
        await updateLead(id, { aiSpecifics: parts, aiFrom });
        const lead = leads.find((l) => String(l.threadId) === String(id));
        if (lead) { lead.aiSpecifics = parts; lead.aiFrom = aiFrom; }
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
  if (n || aiCount) await log(`rewrote ${n} draft(s)`
    + (readCount ? `, after reading ${readCount} thread(s)` : '')
    + (aiCount ? `, ${aiCount} with fresh Claude lines` : ''));
  return { ok: true, updated: n, ai: aiCount, read: readCount, pending: missing.length - aiCount };
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

  // Read each thread before drafting, so the reply answers the post rather than
  // the title, and knows what the competition has already promised.
  const full = await withThreads(matched, cfg);

  // One batched request for the whole poll, so the instructions are paid for
  // once rather than once per lead. Falls back to the built-in rules.
  const ai = await specificsFor(full, cfg);
  const leads = full.map((m) => {
    const lead = enrich(m, cfg, 'SENT', ai[m.threadId]);
    if (ai[m.threadId]) lead.aiFrom = sourceOf(m);
    return lead;
  });
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

export async function expireStaged() {
  const cfg = await getConfig();
  const staged = await getStaged();
  const cutoff = Date.now() - cfg.stageTtlMinutes * 60000;
  for (const [threadId, e] of Object.entries(staged)) {
    // A tab you opened with "Open filled" is yours until you close it. The
    // expiry is for tabs the watcher armed by itself in the background, which
    // is where stale tabs actually pile up.
    if (e.by === 'you') continue;
    if (e.at < cutoff) {
      chrome.tabs.remove(e.tabId).catch(() => {});
      await setStaged(threadId, null);
      await updateLead(threadId, { staged: false });
    }
  }
}

/**
 * Your taps on the Telegram buttons, acted on here.
 *
 * Tap "Send this PM" on your phone and Chrome opens the compose page, types it
 * in and sends it. Tap "Post this reply" and it posts. The message on your
 * phone is then edited to say what happened, buttons gone, so the same lead
 * cannot be fired twice from the same card.
 *
 * Two things this refuses to do:
 *
 *  - Act on a tap from anywhere but your own chat. The bot token is a bearer
 *    token; anyone who got hold of it could otherwise make your signed-in
 *    browser post to the forum under your name. A tap whose chat does not
 *    match the configured chat id is dropped and logged.
 *  - Skip the daily caps and spacing. An approval is permission, not an
 *    override: if you are at your own limit it says so on the message and
 *    posts nothing.
 *
 * Never throws: a poll must not die on a bad tap.
 */
export async function pollTaps() {
  const cfg = await getConfig();
  if (!cfg.telegramApprovals || !cfg.telegramChatId) return { skipped: 'off' };

  let events;
  try { events = await telegram.pendingTaps(); }
  catch (e) { await log(`Telegram taps could not be read: ${e.message}`, 'error'); return { error: e.message }; }
  if (!events.length) return { taps: 0 };

  let done = 0;
  for (const ev of events) {
    if (ev.chatId && String(ev.chatId) !== String(cfg.telegramChatId)) {
      await log(`ignored a Telegram ${ev.kind} from chat ${ev.chatId}, which is not yours`, 'error');
      if (ev.kind === 'tap') await telegram.ackTap(ev.id, 'Not your chat.');
      continue;
    }

    if (ev.kind === 'reply') { if (await takeRewrite(ev, cfg)) done++; continue; }

    const lead = (await getLeads()).find((l) => String(l.threadId) === String(ev.threadId));
    if (!lead) {
      await telegram.ackTap(ev.id, 'That lead is no longer in the table.');
      continue;
    }
    await telegram.ackTap(ev.id, 'Working on it…');
    const line = await runTap(ev, lead, cfg);
    await telegram.settleTap(ev, line);
    await log(`Telegram tap on "${lead.title}": ${line}`);
    done++;
  }
  return { taps: events.length, done };
}

/**
 * Rewriting from the phone.
 *
 * Tap ✏️ Rewrite and the bot asks for the new wording with the reply box
 * already open; whatever is typed comes back as a reply pointing at that
 * prompt, which is how we know which lead and which half it belongs to.
 * The lead is updated and sent back with its buttons, so the next tap posts
 * what you wrote, not what Claude wrote.
 *
 * A reply that answers no prompt of ours is ignored: the bot is not a chat.
 */
const EDITS_KEY = 'tgEdits';
const getEdits = async () => (await chrome.storage.local.get(EDITS_KEY))[EDITS_KEY] || {};
async function setEdit(promptId, entry) {
  const all = await getEdits();
  if (entry) all[promptId] = entry; else delete all[promptId];
  // Only the last few matter; an abandoned prompt should not live forever.
  const keys = Object.keys(all);
  if (keys.length > 20) for (const k of keys.slice(0, keys.length - 20)) delete all[k];
  await chrome.storage.local.set({ [EDITS_KEY]: all });
}

async function takeRewrite(ev, cfg) {
  const edits = await getEdits();
  const want = edits[String(ev.replyTo)];
  if (!want) return false;                      // not answering anything of ours
  await setEdit(String(ev.replyTo), null);

  const lead = (await getLeads()).find((l) => String(l.threadId) === String(want.threadId));
  if (!lead) { await telegram.say(cfg.telegramChatId, 'That lead is no longer in the table.'); return false; }

  const body = String(ev.body || '').trim();
  if (!body) { await telegram.say(cfg.telegramChatId, 'That came through empty, so nothing was changed.'); return false; }

  // draftEdited matters: a staged tab still holds the OLD text, so postLead
  // has to type the new one in rather than just pressing Submit on the old.
  const patch = want.field === 'dm'
    ? { dm: body, dmLint: lintDraft(body, cfg.compliance) }
    : { draft: body, draftEdited: true, lint: lintDraft(body, cfg.compliance) };
  await updateLead(lead.threadId, patch);
  await log(`rewrote the ${want.field === 'dm' ? 'PM' : 'public reply'} for "${lead.title}" from Telegram`);

  const fresh = { ...lead, ...patch };
  fresh.card = buildCard(fresh);
  await telegram.resend(fresh, cfg, want.field === 'dm' ? 'PM' : 'reply');
  return true;
}

/** One tap. Returns the line that goes back on the message. */
async function runTap(tap, lead, cfg) {
  try {
    if (tap.action === 'e' || tap.action === 'm') {
      const which = tap.action === 'm' ? 'PM' : 'public reply';
      const current = tap.action === 'm' ? lead.dm : lead.draft;
      const promptId = await telegram.askFor(cfg.telegramChatId,
        `✏️ Send the new ${which} for "${String(lead.title).slice(0, 60)}".\n\n`
        + `Reply to this message with the whole thing - what you send replaces it.\n\n`
        + `Now:\n${plain(current || '(empty)').slice(0, 900)}`);
      if (!promptId) return '❌ Could not open the rewrite box.';
      await setEdit(String(promptId), { threadId: String(lead.threadId), field: tap.action === 'm' ? 'dm' : 'draft' });
      return `✏️ Waiting for your new ${which} - reply to the message below.`;
    }

    if (tap.action === 's') {
      await updateLead(lead.threadId, { status: 'SKIPPED', decidedAt: new Date().toISOString() });
      return '⏭ Skipped.';
    }

    // Both of these go through the same functions the dashboard buttons use.
    // They already count the send against your daily cap and mark the row, so
    // doing it again here would charge you twice for one PM.
    if (tap.action === 'd') {
      if (lead.pmSent) return '✉️ Already sent - not sending it twice.';
      const gate = await checkDmLimit(cfg);
      if (!gate.ok) return `✋ Held: ${gate.reason}`;
      const r = await sendDm(lead, cfg, { mode: 'send' });
      return r?.ok && r?.sent ? '✉️ PM sent.' : `❌ Could not send it: ${r?.error || 'unknown'}`;
    }

    if (tap.action === 'p') {
      if (lead.status === 'POSTED') return '🚀 Already posted - not posting it twice.';
      const gate = await checkRateLimit(cfg);
      if (!gate.ok) return `✋ Held: ${gate.reason}`;
      const r = await postLead(lead, cfg, { edited: !!lead.draftEdited });
      return r?.ok ? `🚀 Posted.${r.postUrl ? ` ${r.postUrl}` : ''}`
                   : `❌ Could not post it: ${r?.error || 'unknown'}`;
    }

    return `Did not recognise that button (${tap.action}).`;
  } catch (e) {
    return `❌ ${e.message}`;
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
      // Staged means you asked for it and are about to read it, so the tab
      // comes to the front: the insert runs through the browser's editing
      // pipeline, which wants a focused document. An auto-post stays behind.
      const tab = await chrome.tabs.create({ url: lead.url, active: mode === 'stage' && !!opts.keepTab });
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
        // Drop the bookkeeping either way, but only close the tab if the
        // watcher opened it. Closing a tab you opened yourself, a second after
        // filling it, is what "Open filled" used to do to itself.
        if (staged) {
          if (staged.by !== 'you') chrome.tabs.remove(staged.tabId).catch(() => {});
          await setStaged(msg.threadId, null);
        }
        await updateLead(msg.threadId, { status: msg.status, staged: false, error: '' });
        if (cfg.webhookUrl) await reportResult(cfg, msg.threadId, msg.status, msg.detail || '').catch((e) => log(`sheet update failed: ${e.message}`, 'error'));
        sendResponse({ ok: true });
        break;
      }
      case 'deep-backfill': {                        // walk N listing pages into the database
        sendResponse(await deepBackfill(msg.opts || {}).catch((e) => ({ error: e.message })));
        break;
      }
      case 'reply-landed': {                         // the content script saw the post appear
        await replyLanded(msg.threadId, msg.postUrl, 'seen in the tab');
        sendResponse({ ok: true });
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
          await setStaged(msg.lead.threadId, { tabId: r.tabId, at: Date.now(), title: msg.lead.title, by: 'you' });
          // FILLED, not POSTED: the reply is typed in but you have not pressed
          // Post reply yet, and the row should not claim you did. It turns
          // POSTED by itself the moment the reply actually lands - see
          // 'haf-reply-landed' below - and goes back to the to-do list if you
          // close the tab without posting.
          await updateLead(msg.lead.threadId, { staged: true, status: 'FILLED', filledAt: new Date().toISOString() });
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
      case 'tg-check': {                             // why is nothing arriving
        sendResponse(await telegram.diagnose(await getConfig()).catch((e) => ({ ok: false, checks: [['✗', e.message]] })));
        break;
      }
      case 'tg-taps': {                              // check for taps right now
        sendResponse(await pollTaps().catch((e) => ({ error: e.message })));
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
