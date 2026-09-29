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
import { pushConfig, restoreIfEmpty, exportAll, importAll, readSynced } from './backup.js';
import * as night from './night.js';
import * as auto from './auto.js';
import { fetchFeed, threadIdFromUrl } from './feed.js';
import { fetchListing, fetchListingPages, forumUrlFromFeed, withListing } from './listing.js';
import { fetchThread, fetchThreads, fetchThreadTitle } from './thread.js';
import { rivalBrief, upgradeReason, sourceOf } from './rivals.js';
import { matchLead, isExcludedThread } from './matcher.js';
import { sampleThread, unscored } from './sample.js';
import { renderReply, renderDm, renderDmTitle, plain, spin } from './templates.js';
import * as services from './services.js';
import * as traffic from './traffic.js';
import { lintDraft, botTextIn, stripBotText } from './compliance.js';
import { buildCard, buildThreadCard, setCardZone } from './telegram-card.js';
import { sourcesOf, watchWordsOf, wordHits, isSalesThread, isMarketForum, intentOf, normalizeForumUrl, labelFromUrl, forumNodeOf, HAF_NODE, SITE_KEY } from './sources.js';
import { getIndex, upsertIndex, patchIndex, searchIndex, indexStats } from './threadindex.js';
import { addToBank, bankMatches, bankStats } from './bank.js';
import { materialMessages } from './material.js';
import { readListingTab, readListingPages, readThreadTab, readThreadsInTabs, WHATS_NEW } from './browse.js';
import { pushLeads, fetchApproved, reportResult, fetchRecent } from './sync.js';
import * as telegram from './telegram.js';
import { alive } from './alive.js';
import { applySeed, seedStatus, SEED_FILE } from './seed.js';
import { syncStatus } from './vault.js';
import { SILENT_STATUSES, TOO_OLD, BASELINE, selectQueue, queueCounts } from './announce.js';
import { fetchConversations, matchLead as matchConversation } from './messages.js';
import { writeSpecifics, aiStatus, saveKey, clearKey, setBudget, setModel, setEnabled, testCall,
         revealKey, factoryReset, addCredits, resetSpend } from './claude.js';
import {
  getSeen, markSeen, clearSeen, isFirstRun, recordLeads, getLeads, updateLead, mergeLeads, updateReplyCounts,
  checkRateLimit, recordPost, unrecordPost, checkDmLimit, recordDm, unrecordDm, getRateState, log, logOnce, clearLogOnce,
  getStaged, setStaged, removeStagedByTab, dedupeLeads, getTrafficSamples, addTrafficSample, getLog
} from './store.js';

const FEED_ALARM = 'poll-feed';
const APPROVAL_ALARM = 'poll-approvals';
const UPDATE_ALARM = 'check-update';
const PM_ALARM = 'sync-pms';
const TAP_ALARM = 'telegram-taps';
const BUMP_ALARM = 'bump-check';

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
/**
 * The marker for a flag this check set from the message list alone.
 *
 * Only these are ever taken back. A PM the extension watched itself send is
 * marked 'sent from here' and is never second-guessed - the list not matching
 * it means the subject drifted, not that the PM never happened.
 */
const FOUND_IN_LIST = 'your BHW message list';

export async function syncSentPms({ pages = 1 } = {}) {
  const cfg = await getConfig();
  const told = cfg.bhwUsername || '';
  const { rows, me } = await fetchConversations(pages, { told });
  const leads = await getLeads();
  let marked = 0, known = 0, cleared = 0, maybes = 0;

  for (const lead of leads) {
    const hit = matchConversation(lead, rows, me);

    // Clearing, which did not exist before. A flag set by the old loose rules
    // was permanent: nothing re-examined it, so a lead marked done by mistake
    // stayed done, kept refusing the Telegram tap as a duplicate, and kept its
    // slot charged to the daily cap. A flag this check put there has to be one
    // this check can take away.
    if (lead.pmSent && lead.pmFrom === FOUND_IN_LIST && !hit?.sent) {
      await updateLead(lead.threadId, {
        pmSent: false, pmSentAt: '', pmFrom: '',
        pmMaybe: hit?.maybe ? (hit.why || 'a conversation exists') : '',
        pmMaybeUrl: hit?.maybe ? hit.url || '' : ''
      });
      await unrecordDm();                              // give the slot back
      cleared++;
      continue;
    }
    if (!hit) continue;

    if (hit.sent) {
      if (lead.pmSent) continue;                       // already known, nothing to do
      await updateLead(lead.threadId, {
        pmSent: true, pmSentAt: hit.at || new Date().toISOString(),
        pmFrom: FOUND_IN_LIST, pmUrl: hit.url || '', pmMaybe: '', pmMaybeUrl: ''
      });
      // Only charge today's cap for something sent today. Discovering a PM
      // from last week is not a PM sent now, and counting it was spending
      // today's allowance on history.
      if (String(hit.at || '').slice(0, 10) === new Date().toLocaleDateString('en-CA')) await recordDm();
      // The card on your phone still offers to send it. Correct it in place so
      // the button is gone and the conversation is one tap away - a tap that
      // can only be refused is worse than no button at all.
      const card = lead.tgCards?.PM;
      if (card && cfg.telegramChatId) {
        await telegram.refreshCard(cfg.telegramChatId, card,
          { ...lead, pmSent: true, pmUrl: hit.url || '' }, 'PM', cfg).catch(() => {});
      }
      marked++;
    } else if (hit.maybe) {
      // Not proof. Remembered so the tap can show it to you and let you judge.
      await updateLead(lead.threadId, { pmMaybe: hit.why || 'a conversation exists', pmMaybeUrl: hit.url || '' });
      maybes++;
    } else if (!lead.priorContact) {
      await updateLead(lead.threadId, { priorContact: hit.at ? hit.at.slice(0, 10) : 'earlier' });
      known++;
    }
  }
  if (!me) {
    // Failing closed is right - marking leads done on a bad guess is worse -
    // but it must never be quiet about it. A silent "0 already sent" reads
    // exactly like "nothing to do", which is how this looked broken for days.
    await logOnce('whoami', 'Could not work out which BHW account you are, so nothing can be '
      + 'marked as already sent. Open Settings and type your BHW username in "Your BHW username".', 'error');
  } else {
    await clearLogOnce('whoami');
  }
  await log(`checked ${rows.length} conversation(s): ${marked} already sent, ${cleared} wrongly marked and cleared, `
    + `${maybes} worth a look, ${known} previously contacted`
    + (me ? ` (as ${me})` : ' — BUT your account could not be identified, so nothing was marked sent'),
    (cleared || !me) ? 'error' : 'info');
  return { conversations: rows.length, me, marked, known, cleared, maybes };
}

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  // A fresh install on a new machine: take the settings back from sync before
  // anything reads them, or the extension comes up looking configured - the
  // vault has the secrets - with every setting silently back to its default.
  const back = await restoreIfEmpty().catch(() => ({}));
  await settleOldLeads();
  // haf-secrets.json in the extension folder, if there is one: the keys travel
  // with the folder, so a copy onto a new machine configures itself instead of
  // needing the Anthropic key and the Telegram token retyped over RDP. Runs
  // before anything reads the config, and fills gaps only.
  const seeded = await applySeed().catch((e) => ({ error: e.message }));
  const migrated = await migrateConfig();
  // New wording shipped with the code is taken up before anything reads the
  // config, and before setConfig writes it back - otherwise that write would
  // freeze the old wording in again, which is the whole bug this fixes.
  const adopt = await adoptNewTemplates().catch(() => ({}));
  let cfg = await getConfig();
  await setConfig(cfg);
  await scheduleAlarms(cfg);
  await log(details.reason === 'install' ? 'installed' : `reloaded (v${chrome.runtime.getManifest().version}${migrated ? ', settings upgraded' : ''})`);
  if (back.restored) await log(`brought ${back.keys} setting(s) back from your other Chrome`);
  await logSeed(seeded);
  await pushConfig(cfg).catch(() => {});
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
    const r = await rebuildDrafts({ withAi: false, syncApproved: false });
    await chrome.storage.local.set({ draftStamp: stamp });
    if (r.updated) await log(`templates changed: ${r.updated} stored draft(s) brought up to date`);
  } catch (e) {
    await log(`could not refresh drafts: ${e.message}`, 'error');
  }
}
chrome.runtime.onStartup.addListener(async () => {
  // Also on every browser start, not just install: on a server the folder may
  // be updated underneath a Chrome that is never reinstalled, and a restart is
  // the moment to notice.
  await logSeed(await applySeed().catch((e) => ({ error: e.message })));
  await scheduleAlarms(await getConfig());
});

/** Say what the seed file did, and nothing at all when there is not one. */
async function logSeed(r) {
  if (!r || r.none || r.already) return;
  if (r.error) return log(`${SEED_FILE}: ${r.error}`, 'error');
  const took = (r.secrets || []).join(' and ');
  await log(`${SEED_FILE}: filled in ${took || 'no keys'}`
    + `${r.settings ? `, ${r.settings} setting(s)` : ''}`
    + `${r.kept?.length ? ` (kept the ${r.kept.join(' and ')} key already in this browser)` : ''}`);
}

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
  if (!cfg.enabled) {
    // No alarms at all, which means pollTaps never runs and cannot report its
    // own reasons - so this is the one place the paused state can be said.
    await chrome.alarms.clear(TAP_ALARM);
    await logOnce('paused', 'HAF Watcher is paused in Settings: nothing is being checked and '
      + 'your Telegram buttons will do nothing. Switch it on to start.', 'error');
    return;
  }
  await clearLogOnce('paused');
  chrome.alarms.create(FEED_ALARM, { periodInMinutes: Math.max(1, cfg.pollMinutes), delayInMinutes: 0.1 });
  chrome.alarms.create(APPROVAL_ALARM, { periodInMinutes: Math.max(1, cfg.approvalPollMinutes) });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
  // Hourly is plenty: it is a safety net for PMs sent elsewhere, and the
  // button on the dashboard covers wanting it now.
  chrome.alarms.create(PM_ALARM, { periodInMinutes: 60, delayInMinutes: 2 });
  // Your own service threads: a short, fixed list, so checking every 30
  // minutes is plenty to catch a bump becoming eligible without being noisy.
  chrome.alarms.create(BUMP_ALARM, { periodInMinutes: 30, delayInMinutes: 3 });

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

// Every alarm runs inside `alive`: the work below waits on the network and on
// content scripts for far longer than MV3's 30-second idle budget, and a worker
// killed mid-job leaves no error anywhere because the handler dies with it.
chrome.alarms.onAlarm.addListener(async (alarm) => alive(async () => {
  try {
    if (alarm.name === FEED_ALARM) {
      const cfg = await getConfig();
      // Jitter so the fetch doesn't land on the same second every cycle.
      await new Promise((r) => setTimeout(r, Math.random() * (cfg.jitterSeconds || 0) * 1000));
      await runCheck();          // new threads, then your message list
    }
    if (alarm.name === APPROVAL_ALARM) { await expireStaged(); await pollApprovals(); }
    if (alarm.name === TAP_ALARM) await pollTaps();
    if (alarm.name === UPDATE_ALARM) {          // the minute tick doubles as the night/auto runner
      await runNightQueue().catch((e) => log(`night mode: ${e.message}`, 'error'));
      await runAutoQueue().catch((e) => log(`auto mode: ${e.message}`, 'error'));
      await nightSummary().catch(() => {});
    }
    if (alarm.name === UPDATE_ALARM) await checkForUpdate();
    // The hourly alarm stays as a backstop: polling can be switched off, or a
    // cycle can fail, and the list should still be reconciled eventually.
    if (alarm.name === PM_ALARM) await syncSentPms().catch((e) => log(`PM check: ${e.message}`, 'error'));
    if (alarm.name === BUMP_ALARM) await checkServiceBumps().catch((e) => log(`bump check: ${e.message}`, 'error'));
  } catch (e) {
    await log(`${alarm.name}: ${e.message}`, 'error');
  }
}));

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
  let got;
  if (cfg.readMode === 'feeds') got = await fetchThreads(leads, { max, delayMs }).catch(() => ({}));
  else {
    got = await readThreadsInTabs(leads, { max, gapMs: Math.max(2, Number(cfg.threadReadGapSeconds) || 8) * 1000 }).catch(() => ({}));
    if (got.__blocked) { await wall(got.__blocked); delete got.__blocked; }
  }
  const read = Object.keys(got).length;
  if (read) {
    const rivals = Object.values(got).reduce((n, t) => n + (t.replies?.length || 0), 0);
    await log(`read ${read} thread(s) for the full post${rivals ? ` and ${rivals} reply/replies already on them` : ''}`);
  }
  return leads.map((l) => (got[l.threadId] ? { ...l, ...got[l.threadId] } : l));
}

export async function specificsFor(leads, cfg, { force = false } = {}) {
  if (!cfg.aiSpecifics || !leads.length) return { specifics: {}, note: '' };

  // Claude is only asked when there is an upgrade in it. A lead whose post and
  // whose competition have not changed since its lines were written would come
  // back with the same answer, so asking again is money for nothing.
  const wanted = force ? leads.map((l) => ({ l, why: 'asked for directly' }))
                       : leads.map((l) => ({ l, why: upgradeReason(l) })).filter((x) => x.why);
  const skipped = leads.length - wanted.length;
  if (!wanted.length) {
    if (skipped) await log(`Claude not needed: ${skipped} draft(s) already answer the thread as it stands`);
    return { specifics: {}, note: '' };
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
  return { specifics, note };
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
export async function rebuildDrafts({ withAi = false, syncApproved = true } = {}) {
  const cfg = await getConfig();
  const leads = await getLeads();
  // Thread leads from the watched forums are yours to write, never templated.
  const open = (l) => !['POSTED', 'SKIPPED'].includes(l.status) && l.kind !== 'thread';
  const candidates = leads.filter(open);

  let aiCount = 0, readCount = 0, missing = [];
  const answered = new Set();
  let lastStandDownNote = '';
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

      const { specifics: fresh, note } = await specificsFor(worth, cfg);
      if (note) lastStandDownNote = note;
      for (const [id, parts] of Object.entries(fresh)) {
        const from = worth.find((b) => String(b.threadId) === String(id));
        const aiFrom = from ? sourceOf(from) : undefined;
        await updateLead(id, { aiSpecifics: parts, aiFrom, draftedBy: 'claude', draftedByNote: '' });
        const lead = leads.find((l) => String(l.threadId) === String(id));
        if (lead) { lead.aiSpecifics = parts; lead.aiFrom = aiFrom; lead.draftedBy = 'claude'; lead.draftedByNote = ''; }
        aiCount++;
        answered.add(String(id));
      }
      if (!Object.keys(fresh).length) break;        // stood down; stop asking
    }

    // Anything worth re-asking that did NOT get a fresh answer this round -
    // budget, a bad key, a network error - keeps running on the built-in
    // rules. A lead with no earlier real answer either is generic from here
    // on, and the card has to say so rather than reading like a real one.
    for (const b of missing) {
      const id = String(b.threadId);
      if (answered.has(id)) continue;
      const lead = leads.find((l) => String(l.threadId) === id);
      if (lead?.aiSpecifics?.tips?.length || lead?.aiSpecifics?.length) continue;   // an earlier real answer stands
      const patch = { draftedBy: 'rules', draftedByNote: lastStandDownNote || 'Claude did not write this one' };
      await updateLead(id, patch);
      if (lead) Object.assign(lead, patch);
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

    // A lead already on your phone: only touch the frozen, approved text when
    // the caller explicitly asked for that (the "Rewrite drafts" button). This
    // is what went wrong before - refreshIfTemplatesChanged calls this
    // automatically on every reload, and every release this week changed the
    // template wording, so every reload silently re-approved every announced
    // lead's text to whatever the NEW wording was. The Telegram edit that was
    // supposed to keep the card in step could fail without anyone noticing -
    // Telegram will not edit a message older than 48 hours, and the failure
    // was swallowed - and even when it worked, an edited message is easy to
    // miss if you already read it. Either way the card kept showing what you
    // approved, dmApproved silently became something else, and days later you
    // sent text you had never seen. draft/dm (the CANDIDATE, shown on the
    // dashboard) still update on every path; only the FROZEN copy is gated.
    if (syncApproved && l.tgSentAt && l.tgCards && cfg.telegramChatId) {
      const fresh = { ...l, ...patch };
      let synced = true;
      for (const [kind, id] of [['PM', l.tgCards?.PM], ['reply', l.tgCards?.['public reply']]]) {
        if (!id) continue;
        const ok = await telegram.refreshCard(cfg.telegramChatId, id, fresh, kind, cfg).catch(() => false);
        if (!ok) synced = false;
      }
      if (synced) {
        patch.dmApproved = plain(dm);
        patch.draftApproved = plain(draft);
      } else {
        // The card on the phone could not be updated - most likely the 48-hour
        // edit window has passed. Leaving the approved text as it was keeps
        // "what is shown" and "what is sent" agreeing; it is stale, not wrong.
        await log(`could not update the Telegram card for "${l.title}" - it may be past `
          + 'the 48h edit window. Re-send it to get the new wording, or it will '
          + 'send with the text already approved.', 'error');
      }
    }
    await updateLead(l.threadId, patch);
    n++;
  }
  if (n || aiCount) await log(`rewrote ${n} draft(s)`
    + (readCount ? `, after reading ${readCount} thread(s)` : '')
    + (aiCount ? `, ${aiCount} with fresh Claude lines` : ''));
  return { ok: true, updated: n, ai: aiCount, read: readCount, pending: missing.length - aiCount };
}

/**
 * Everything derived from a matched thread: public reply, PM draft, lint,
 * Telegram card.
 *
 * draftedByNote - the reason Claude did not answer this round (e.g. "daily
 * limit reached"), when the caller knows one - has to arrive BEFORE the card
 * is built below, not be patched onto the lead afterward: the card is built
 * here, once, and a field added after this returns never reaches it.
 */
export function enrich(m, cfg, status, aiSpecifics, draftedByNote) {
  setCardZone(cfg);                    // the card's times use the same zone
  // Claude returns { tips, question, offer }; older rows hold a bare array.
  const hasAi = !!(aiSpecifics?.tips?.length || aiSpecifics?.length);
  if (hasAi) m = { ...m, aiSpecifics };
  const draft = renderReply(m, cfg);
  const dm = renderDm(m, cfg);
  const dmTitle = renderDmTitle(m, cfg);
  const lead = {
    ...m, draft, dm, dmTitle, dmUrl: dmUrl(m.author),
    lint: lintDraft(draft, cfg.compliance),
    dmLint: lintDraft(dm, cfg.compliance),
    // Whether the technical lines above are Claude's own reading of the
    // thread, or the built-in rules' generic fallback - shown on the card
    // (see telegram-card.js) so a generic draft is never mistaken for a real
    // answer.
    draftedBy: hasAi ? 'claude' : 'rules',
    draftedByNote: hasAi ? '' : (draftedByNote || ''),
    status, foundAt: new Date().toISOString()
  };
  lead.card = buildCard(lead);
  return lead;
}

/**
 * One check: new threads, then your message list.
 *
 * Both halves, in that order, wherever a check is triggered - the alarm and the
 * button alike. It is a wrapper rather than a few lines at the end of pollFeed
 * because pollFeed returns early in several places (disabled, first run, no new
 * threads) and the message list has to be read on all of them: "nothing new on
 * the forum" says nothing about what you sent from your phone since.
 *
 * The sweep never fails a check. An unreadable list leaves the leads as they
 * are and logs why.
 */
/**
 * Sweep every lead not yet posted or PM'd against the current exclude rules,
 * and clear out any that now match - marked SKIPPED, exactly like tapping
 * Skip yourself. Catches two cases pollFeed's own filter cannot: a thread
 * already recorded before you added it (or its author) to the exclude list,
 * and one recorded before sticky detection existed. Runs every check, so
 * adding an id with the "exclude" command clears it out on the next poll
 * rather than only for future threads.
 */
export async function settleExcludedLeads(cfg) {
  const leads = await getLeads();
  let n = 0;
  for (const l of leads) {
    if (['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status) || l.pmSent) continue;
    if (!isExcludedThread(l, cfg)) continue;
    await updateLead(l.threadId, { status: 'SKIPPED', decidedAt: new Date().toISOString() });
    n++;
  }
  if (n) await log(`${n} mod/rules thread(s) cleared from the queue (excluded by rule)`);
  return { settled: n };
}

export async function runCheck() {
  // Asleep: a member is not reading the forum at 3am. Nothing is fetched or
  // opened; taps from Telegram are still honoured by their own alarm.
  const cfgS = await getConfig();
  if (cfgS.sleepEnabled && night.inWindow(cfgS, cfgS.sleepStart, cfgS.sleepEnd)) {
    await logOnce('asleep', `asleep until ${cfgS.sleepEnd} (${cfgS.timezone || 'local time'}) - no BHW reads; change it under Settings if you want`, 'info', 180);
    return { skipped: 'asleep', until: cfgS.sleepEnd };
  }
  await clearLogOnce('asleep');
  // The two halves are independent, so neither may take the other down with
  // it. A forum that will not load says nothing about your message list, and
  // the list is what keeps the table honest about what has already been sent.
  let r, failed;
  try { r = await pollFeed(); }
  catch (e) { failed = e.message; await log(`feed check: ${e.message}`, 'error'); }

  // The watched forums and the site-wide feed, after HAF so HAF keeps its own.
  let sources;
  try { sources = await pollSources(); }
  catch (e) { sources = { error: e.message }; await log(`sources check: ${e.message}`, 'error'); }

  const cfg0 = await getConfig();
  await settleExcludedLeads(cfg0).catch((e) => log(`exclude sweep: ${e.message}`, 'error'));

  // On every path, including the quiet ones. pollFeed returns early when
  // nothing is new, and that is exactly when a backlog from a busy poll needs
  // draining - waiting for the next new thread to carry it along could be
  // hours, or never.
  const told = await announceNew(cfg0).catch((e) => ({ error: e.message }));

  // Your message list, but not on every check: it is one more page load, and
  // nothing on it changes faster than you send PMs.
  const { pmCheckedAt = 0 } = await chrome.storage.local.get('pmCheckedAt');
  const pmEvery = Math.max(1, Number(cfg0.pmCheckMinutes) || 15) * 60000;
  let pms = { skipped: 'not due' };
  if (Date.now() - pmCheckedAt >= pmEvery) {
    await chrome.storage.local.set({ pmCheckedAt: Date.now() });
    pms = await syncSentPms().catch(async (e) => {
      await log(`PM check: ${e.message}`, 'error');
      return { error: e.message };
    });
  }
  return { ...(r || {}), ...(failed ? { error: failed } : {}), sources, told, pms };
}

/**
 * Send whatever has not reached Telegram yet, newest first.
 *
 * Reads the table rather than taking a list, which is what makes it correct on
 * every path. Only a handful go per poll - a quiet burst rather than a flood -
 * and a thread is only "new" once, so the ones that did not fit used to wait
 * for a re-find that never comes. Worse, they were stamped as announced
 * anyway: a poll that found 33 threads sent six and silenced twenty-seven, with
 * nothing anywhere saying so. Now only what actually went is stamped, and the
 * rest are still here to be picked up next time.
 *
 * Decided leads are skipped: something you have already posted, skipped or let
 * expire does not need announcing days later.
 */
/**
 * Draw a line under everything already in the table, once.
 *
 * The "announced" stamp only started existing in v0.78, so every lead found
 * before it looks as though it has never been sent. The backlog then works
 * through the whole table six at a time - which is old threads arriving on
 * your phone for days, most of which were sent to you when they were new.
 *
 * Runs once, on the first start after this version. Anything already here is
 * treated as dealt with; only threads found from now on can be announced.
 */
const LINE_KEY = 'announcedBaseline';

export async function settleOldLeads() {
  const { [LINE_KEY]: done } = await chrome.storage.local.get(LINE_KEY);
  if (done) return { already: true };

  const leads = await getLeads();
  let n = 0;
  for (const l of leads) {
    if (l.tgSentAt) continue;
    await updateLead(l.threadId, { tgSentAt: BASELINE });
    n++;
  }
  await chrome.storage.local.set({ [LINE_KEY]: new Date().toISOString() });
  if (n) await log(`${n} lead(s) already in the table will not be re-sent to Telegram; `
    + 'only threads found from now on are announced');
  return { settled: n };
}

/**
 * Today, in one line: what went out, what failed, what is left.
 *
 * Appended to every outcome on your phone, because "Posted." on its own tells
 * you the tap worked and nothing about where you are. Reads the same counters
 * the dashboard meters use, so the two can never disagree.
 */
export async function todayLine(cfg) {
  const r = await getRateState();
  const leads = await getLeads();
  const day = new Date().toLocaleDateString('en-CA');
  const on = (t) => String(t || '').slice(0, 10) === day;

  const failed = leads.filter((l) => on(l.pmSentAt || l.decidedAt) && (l.pmError || l.error)).length;
  const waiting = leads.filter((l) => !SILENT_STATUSES.includes(l.status) && !l.pmSent).length;
  const cap = (used, max) => (Number(max) > 0 ? `${used}/${max}` : String(used));

  return `📊 Today: ${cap(r.count || 0, cfg.maxPostsPerDay)} replies · `
    + `${cap(r.dmCount || 0, cfg.maxDmsPerDay)} PMs`
    + (failed ? ` · ${failed} failed` : '')
    + ` · ${waiting} still to do`;
}

/**
 * The fuller picture, on request. Send "status" to the bot.
 *
 * Everything the dashboard shows, for when you are not at the machine - which
 * is most of the time if you are working from the phone.
 */
export async function statusReport(cfg) {
  const r = await getRateState();
  const leads = await getLeads();
  const day = new Date().toLocaleDateString('en-CA');
  const on = (t) => String(t || '').slice(0, 10) === day;

  const foundToday = leads.filter((l) => on(l.foundAt)).length;
  const postedToday = leads.filter((l) => l.status === 'POSTED' && on(l.decidedAt || l.postedAt)).length;
  const pmToday = leads.filter((l) => l.pmSent && on(l.pmSentAt)).length;
  const failed = leads.filter((l) => l.pmError || l.error).slice(0, 5);
  const todo = leads.filter((l) => !SILENT_STATUSES.includes(l.status) && !l.pmSent);
  const hb = await tapsHeartbeat();
  const beat = hb ? Math.round((Date.now() - hb.at) / 1000) : null;

  // Whether an old-thread repeat is even possible on this install. The stamp
  // that stops it (tgSentAt) only exists from v0.78 - an install still running
  // an older build has none of this, and no amount of auditing the current
  // code proves anything about what an older build is doing. This is the one
  // line that tells the two apart without guessing.
  const running = chrome.runtime.getManifest().version;
  const { announcedBaseline } = await chrome.storage.local.get('announcedBaseline');
  const { queued, stale } = queueCounts(leads, cfg);

  // Anything actually mid-send right now - the same lock sendDm sets and
  // checks against a second tap. status answers "is something happening"
  // without needing to find the right card and read its button.
  const inFlight = leads.filter((l) => l.pmSending && Date.now() - l.pmSending < PM_LOCK_MS);
  const autoQueue = auto.pending(leads);

  // A generic draft was quietly indistinguishable from a real one until the
  // card itself started saying so (see telegram-card.js). Whether that has
  // actually been happening today belongs in the one place you check daily,
  // not only on the card you happened to still be looking at.
  const ai = cfg.aiSpecifics ? await aiStatus().catch(() => null) : null;
  const genericToday = leads.filter((l) => on(l.foundAt) && l.draftedByNote).length;

  const lines = [
    `📊 <b>Today</b>`,
    `Running v${running}`,
    `Found: ${foundToday} · Replies posted: ${postedToday} · PMs sent: ${pmToday}`,
    `Caps: ${r.count || 0}/${cfg.maxPostsPerDay || '∞'} replies · ${r.dmCount || 0}/${cfg.maxDmsPerDay || '∞'} PMs`,
    `Telegram queue: ${queued} waiting to be announced, ${stale} held back as too old`
      + (announcedBaseline ? '' : ' — baseline not yet set, old leads may still announce'),
    `Still to do: ${todo.length}`,
    `⚡ Auto mode: ${cfg.autoMode ? 'ON' : 'off'}`
      + (cfg.autoMode && autoQueue.length ? ` — ${autoQueue.length} counting down` : '')
      + ` · ${leads.filter((l) => l.autoSentAt && String(new Date(l.autoSentAt).toLocaleDateString('en-CA')) === day).length} PM(s) auto-sent today (send "auto" for detail)`,
    ai ? `🤖 Claude: $${ai.spentToday.toFixed(2)}/${ai.budget ? `$${ai.budget.toFixed(2)}` : '∞'} today`
        + (ai.overBudget ? ' — OVER BUDGET, today\'s drafts are falling back to generic rules' : '')
        + (genericToday ? ` (${genericToday} generic today)` : '')
      : cfg.aiSpecifics ? '' : '🤖 Claude: off — every draft is the built-in generic rules',
    inFlight.length
      ? `⏳ Right now: ${inFlight.map((l) => `"${String(l.title).slice(0, 30)}" `
          + `(${Math.round((Date.now() - l.pmSending) / 1000)}s)`).join(', ')}`
      : '⏳ Right now: nothing in progress',
    '',
    beat == null ? '⚠️ The tap checker has never run - Chrome may not be running.'
      : beat < 120 ? `✅ Connected (checked ${beat}s ago)`
      : `⚠️ Last checked ${Math.round(beat / 60)} min ago - Chrome may not be running.`
  ];

  if (failed.length) {
    lines.push('', `❌ <b>${failed.length} with errors</b>`);
    for (const l of failed) {
      lines.push(`· ${String(l.title || l.threadId).slice(0, 45)} — ${String(l.pmError || l.error).slice(0, 70)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Everything not yet struck through, resent as real cards. "pending",
 * "todo", or "missed" to the bot - defaults to the last 24 hours, since old
 * leads from days ago kept surfacing otherwise, which is the opposite of
 * "what did I just miss". "pending 6" narrows it further, "pending 48"
 * widens it, and "pending 0" is the explicit way back to the whole table.
 *
 * Matches the dashboard's own definition of "unstruck" exactly - not
 * POSTED, not SKIPPED, not EXPIRED, and no PM sent - which deliberately
 * includes a History-labelled (BACKFILL) lead. Those are excluded from the
 * AUTOMATIC queue on purpose (they are not news), but an audit you asked for
 * by name is a different thing: the point is catching whatever slipped
 * through, wherever it is sitting - unless you narrowed the window yourself.
 *
 * Capped higher than the automatic announce batch (6) since this is a batch
 * you explicitly asked for right now, not an unprompted buzz - but still
 * capped, so one request cannot flood the chat with the whole table.
 */
const PENDING_BATCH = 8;

export async function sendPending(cfg, hours = 24, { only = '' } = {}) {
  if (!cfg.telegramChatId) return { skipped: 'off' };

  const leads = await getLeads();
  const windowMs = Math.max(0, Number(hours) || 0) * 3600000;
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  // Measured from the THREAD's own post date, not foundAt (when we happened
  // to record it) - the exact bug already fixed once for the announce queue
  // in announce.js's isTooOld. foundAt is "did we only just notice it", which
  // a backfilled or re-swept lead can satisfy while the thread itself is
  // days old; postedAt is "is this actually recent", which is what a 24h
  // window is supposed to mean. Falls back to foundAt only when postedAt
  // was never recorded at all.
  const ageOf = (l) => new Date(l.postedAt || l.foundAt || 0).getTime();
  const unstruck = leads
    .filter((l) => !['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status) && !l.pmSent
                 && (!only || (only === 'haf' ? l.kind !== 'thread' : l.kind === 'thread'))
                 && String(l.threadId) !== 'sample'
                 && (!cutoff || ageOf(l) >= cutoff))
    .sort((a, b) => ageOf(b) - ageOf(a));

  const windowLabel = windowMs ? ` from the last ${hours}h` : '';
  if (!unstruck.length) {
    await telegram.say(cfg.telegramChatId, `✅ Nothing pending${windowLabel} — everything is posted, PM'd, or skipped.`);
    return { pending: 0 };
  }

  const batch = unstruck.slice(0, PENDING_BATCH);
  try {
    const t = await telegram.sendLeads(batch, cfg, { max: PENDING_BATCH });
    // Same freeze as announceNew: what this card shows is what a tap will
    // send, whether this is the first time or the fifth.
    for (const id of t.sentIds || []) {
      const shown = t.approved?.[String(id)] || {};
      await updateLead(id, {
        tgSentAt: new Date().toISOString(), tgCards: t.cards?.[String(id)],
        dmApproved: shown.dm || '', draftApproved: shown.draft || ''
      });
    }
    const left = unstruck.length - (t.sentIds?.length || 0);
    await telegram.say(cfg.telegramChatId,
      `📋 ${t.sentIds?.length || 0} pending lead(s)${windowLabel} sent above — tap to act, or Skip to clear it.`
      + (left > 0 ? ` ${left} more waiting — send "pending${hours ? ' ' + hours : ''}" again for the next batch.` : ''));
    await log(`sent ${t.sentIds?.length || 0} pending lead(s)${windowLabel} to Telegram on request`
      + (left > 0 ? `, ${left} more waiting` : ''));
    return { pending: unstruck.length, sent: t.sentIds?.length || 0, left };
  } catch (e) {
    await telegram.say(cfg.telegramChatId, `❌ Could not send them: ${e.message}`);
    await log(`pending command failed: ${e.message}`, 'error');
    return { pending: unstruck.length, error: e.message };
  }
}

/**
 * The recap. "today" to the bot: exactly what went out today, with links,
 * rather than the counts alone that "status" gives - for when you want to
 * check what was actually said, not just how many.
 */
export async function sendToday(cfg) {
  if (!cfg.telegramChatId) return { skipped: 'off' };

  const leads = await getLeads();
  const day = new Date().toLocaleDateString('en-CA');
  const on = (t) => String(t || '').slice(0, 10) === day;

  const posted = leads.filter((l) => l.status === 'POSTED' && on(l.decidedAt || l.postedAt))
    .sort((a, b) => new Date(b.decidedAt || 0) - new Date(a.decidedAt || 0));
  const pmd = leads.filter((l) => l.pmSent && on(l.pmSentAt))
    .sort((a, b) => new Date(b.pmSentAt || 0) - new Date(a.pmSentAt || 0));

  if (!posted.length && !pmd.length) {
    await telegram.say(cfg.telegramChatId, '📭 Nothing sent yet today.');
    return { posted: 0, pmd: 0 };
  }

  const lines = [`📬 <b>Today</b> — ${posted.length} repl${posted.length === 1 ? 'y' : 'ies'} posted, `
    + `${pmd.length} PM${pmd.length === 1 ? '' : 's'} sent`];
  if (posted.length) {
    lines.push('', '🚀 <b>Replies</b>');
    for (const l of posted.slice(0, 20)) lines.push(`· ${String(l.title || l.threadId).slice(0, 50)}`
      + (l.postUrl ? `\n  ${l.postUrl}` : ''));
  }
  if (pmd.length) {
    lines.push('', '✉️ <b>PMs</b>');
    for (const l of pmd.slice(0, 20)) lines.push(`· ${String(l.title || l.threadId).slice(0, 50)}`
      + (l.pmUrl ? `\n  ${l.pmUrl}` : ''));
  }
  await telegram.say(cfg.telegramChatId, lines.join('\n'), { html: true });
  return { posted: posted.length, pmd: pmd.length };
}

/**
 * The trend. "digest" (or "digest 14") to the bot: found/posted/PM'd per day
 * over the last N days (7 by default), so a slow week shows up as a shape
 * rather than something you have to notice yourself.
 */
export async function sendDigest(cfg, days = 7) {
  if (!cfg.telegramChatId) return { skipped: 'off' };
  const n = Math.min(30, Math.max(1, Number(days) || 7));

  const leads = await getLeads();
  const key = (t) => t ? new Date(t).toLocaleDateString('en-CA') : null;
  const order = Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return d.toLocaleDateString('en-CA');
  });
  const byDay = Object.fromEntries(order.map((d) => [d, { found: 0, posted: 0, pm: 0 }]));

  for (const l of leads) {
    const f = key(l.foundAt); if (f && byDay[f]) byDay[f].found++;
    if (l.status === 'POSTED') { const p = key(l.decidedAt || l.postedAt); if (p && byDay[p]) byDay[p].posted++; }
    if (l.pmSent) { const m = key(l.pmSentAt); if (m && byDay[m]) byDay[m].pm++; }
  }

  const totals = order.reduce((acc, d) => ({
    found: acc.found + byDay[d].found, posted: acc.posted + byDay[d].posted, pm: acc.pm + byDay[d].pm
  }), { found: 0, posted: 0, pm: 0 });

  const lines = [
    `📈 <b>Last ${n} day${n === 1 ? '' : 's'}</b>`,
    `Found ${totals.found} · Posted ${totals.posted} · PMs ${totals.pm}`, ''
  ];
  for (const d of order) {
    const b = byDay[d];
    lines.push(`${d}: ${b.found} found · ${b.posted} posted · ${b.pm} PM${b.pm === 1 ? '' : 's'}`);
  }
  await telegram.say(cfg.telegramChatId, lines.join('\n'), { html: true });
  return { days: n, ...totals };
}

// ---------------------------------------------------------- service threads
//
// A short, fixed list of threads YOU run (your own "SEO services" / "social
// accounts" / etc. listing) - separate from everything above, which watches
// OTHER people's buyer threads. There is no keyword matching here: you add a
// thread by hand with "track", because there is nothing to discover.
//
// Nothing here posts to BHW by itself. A due thread gets a suggested update
// on Telegram; you post it yourself and tell the bot "bumped <label>" so the
// clock resets. See src/services.js for the actual 24h/72h cadence rule.
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function findServiceThread(cfg, label) {
  const needle = String(label || '').trim().toLowerCase();
  if (!needle) return null;
  return (cfg.serviceThreads || []).find((t) =>
    String(t.id).toLowerCase() === needle || String(t.label || '').toLowerCase() === needle);
}

export async function trackServiceThread(cfg, url, label) {
  const id = threadIdFromUrl(url);
  if (!id) return { ok: false, error: 'Could not find a thread id in that URL.' };
  const threads = (cfg.serviceThreads || []).filter((t) => String(t.id) !== String(id));
  const clean = String(label || '').trim() || `thread ${id}`;
  threads.push({ id: String(id), url: String(url), label: clean });
  await setConfig({ serviceThreads: threads });
  return { ok: true, id: String(id), label: clean };
}

// Matches multiple thread links pasted in one go, however they're separated
// (new lines, spaces, a numbered list) - the box on the Settings page, not
// Telegram, because reading each thread's real title needs your logged-in
// session, which only the extension itself has.
const BHW_URL = /https?:\/\/(?:www\.)?blackhatworld\.com\/[^\s"'<>]+/gi;

export async function batchTrackServiceThreads(cfg, rawText) {
  const seen = new Set();
  const urls = [];
  for (const raw of String(rawText || '').match(BHW_URL) || []) {
    // Strip a "jump to this post" fragment - a link copied straight off BHW's
    // own share button carries one, and threadIdFromUrl only recognises a
    // thread id sitting at the end of the URL.
    const url = raw.split('#')[0];
    const id = threadIdFromUrl(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    urls.push({ url, id });
  }
  if (!urls.length) return { added: [], already: [], noTitle: [] };

  const threads = [...(cfg.serviceThreads || [])];
  const added = [], already = [], noTitle = [];
  for (const { url, id } of urls) {
    const existing = threads.find((t) => String(t.id) === id);
    if (existing) { already.push({ id, url, label: existing.label }); continue; }
    const title = await fetchThreadTitle(url);
    const label = title || `thread ${id}`;
    if (!title) noTitle.push({ id, url });
    threads.push({ id, url, label });
    added.push({ id, url, label });
    // One at a time, with a pause - this reads as a signed-in account
    // browsing its own threads, not a scraper firing off a burst.
    if (urls.length > 1) await new Promise((r) => setTimeout(r, 1200));
  }
  if (added.length) await setConfig({ serviceThreads: threads });
  return { added, already, noTitle };
}

export async function untrackServiceThread(cfg, label) {
  const found = findServiceThread(cfg, label);
  if (!found) return { removed: false };
  await setConfig({ serviceThreads: (cfg.serviceThreads || []).filter((t) => t !== found) });
  return { removed: true, thread: found };
}

/** "bumped <label>" - you posted the update yourself; reset the clock. */
export async function markBumped(cfg, label) {
  const found = findServiceThread(cfg, label);
  if (!found) return { marked: false };
  const threads = (cfg.serviceThreads || []).map((t) => t !== found ? t : {
    ...t, lastBumpedAt: new Date().toISOString(), lastBumpKind: 'promo', bumpNotifiedAt: ''
  });
  await setConfig({ serviceThreads: threads });
  return { marked: true, thread: found };
}

function pickBumpText(cfg) {
  const templates = cfg.bumpTemplates?.length ? cfg.bumpTemplates : DEFAULT_CONFIG.bumpTemplates;
  return spin(templates[Math.floor(Math.random() * templates.length)] || '');
}

/** Suggested wording for one tracked thread, on request, any time. Read-only:
 * never touches bumpNotifiedAt or the eligibility clock, unlike the
 * due-reminder. Shared by the Telegram "idea <label>" command and the
 * service-threads page's own "Get idea" button. */
export function bumpIdeaFor(cfg, label) {
  const found = findServiceThread(cfg, label);
  if (!found) return { ok: false };
  return { ok: true, thread: found, text: pickBumpText(cfg) };
}

/** "idea <label>" - the Telegram side of bumpIdeaFor. */
export async function sendBumpIdea(cfg, label) {
  if (!cfg.telegramChatId) return { skipped: 'off' };
  const r = bumpIdeaFor(cfg, label);
  if (!r.ok) {
    await telegram.say(cfg.telegramChatId, `No service thread called "${escHtml(label)}". Send "services" to see what's tracked.`, { html: true });
    return { ok: false };
  }
  const { thread: found, text } = r;
  await telegram.say(cfg.telegramChatId,
    `💡 Suggested update for <b>${escHtml(found.label || found.id)}</b>:\n\n<pre>${escHtml(text)}</pre>\n\n`
    + (found.url ? `<a href="${escHtml(found.url)}">Open thread</a>\n\n` : '')
    + `This is just wording, not a reminder - post it whenever you like, then send "bumped ${escHtml(found.label || found.id)}" if you do.`,
    { html: true });
  return { ok: true, thread: found };
}

export async function sendServicesStatus(cfg) {
  if (!cfg.telegramChatId) return { skipped: 'off' };
  const threads = cfg.serviceThreads || [];
  if (!threads.length) {
    await telegram.say(cfg.telegramChatId,
      'No service threads tracked yet. Send "track <thread url> <label>" to add one.');
    return { tracked: 0 };
  }
  const lines = [`🧵 <b>Your service threads</b>`];
  for (const t of threads) {
    const status = services.isBumpEligible(t) ? '🔔 eligible now' : `⏳ eligible in ${services.hoursUntilEligible(t)}h`;
    lines.push(`· <b>${escHtml(t.label || t.id)}</b> — ${status}`
      + (t.url ? `\n  <a href="${escHtml(t.url)}">${escHtml(t.url)}</a>` : ''));
  }
  await telegram.say(cfg.telegramChatId, lines.join('\n'), { html: true });
  return { tracked: threads.length };
}

/**
 * Runs on the 30-minute bump alarm. Held to your configured peak-traffic
 * window rather than firing the moment a thread is technically eligible - a
 * bump landing while buyers are actually browsing is worth more than one
 * fired at 3am and buried by morning.
 */
export async function checkServiceBumps() {
  const cfg = await getConfig();
  const threads = cfg.serviceThreads || [];
  if (!threads.length || !cfg.telegramChatId) return { skipped: 'off' };

  // Learn real traffic on every check, whether or not anything is due - the
  // sample is only useful if it keeps arriving on a schedule, not only when
  // there happens to be a thread to bump. Never fails the check: a missed
  // reading is one lost data point, not a broken poll.
  const counts = await traffic.fetchOnlineCounts();
  if (counts) await addTrafficSample(counts);
  const learned = traffic.isHighTrafficNow(await getTrafficSamples(), cfg);
  // Once there is enough real data, use it; until then, the manually
  // configured window (Options -> Your service threads) is the fallback.
  const isPeak = learned.ready ? learned.high : services.isPeakHours(cfg);
  if (!isPeak) return { skipped: 'outside peak hours', learned: learned.ready };

  const due = services.newlyDue(threads);
  if (!due.length) return { due: 0 };

  for (const t of due) {
    const text = pickBumpText(cfg);
    await telegram.say(cfg.telegramChatId,
      `🔔 <b>${escHtml(t.label || t.id)}</b> is due to bump.\n\n`
      + `Suggested update (tap to copy, post it yourself on BHW):\n<pre>${escHtml(text)}</pre>\n\n`
      + (t.url ? `<a href="${escHtml(t.url)}">Open thread</a>\n\n` : '')
      + `Once posted, send "bumped ${escHtml(t.label || t.id)}" so the timer resets.`,
      { html: true });
  }
  const dueIds = new Set(due.map((t) => t.id));
  const next = threads.map((t) => dueIds.has(t.id) ? { ...t, bumpNotifiedAt: new Date().toISOString() } : t);
  await setConfig({ serviceThreads: next });
  await log(`${due.length} service thread(s) due to bump — sent to Telegram`);
  return { due: due.length };
}

/** "traffic" - the live BHW online count, and what the learned pattern says about right now. */
export async function sendTrafficStatus(cfg) {
  if (!cfg.telegramChatId) return { skipped: 'off' };
  const counts = await traffic.fetchOnlineCounts();
  const samples = await getTrafficSamples();
  const learned = traffic.isHighTrafficNow(samples, cfg);

  const lines = [`📶 <b>BHW traffic</b>`];
  lines.push(counts
    ? `Right now: ${counts.members} members online (${counts.total} total visitors)`
    : 'Could not read the online count just now.');
  lines.push(learned.ready
    ? `This hour is usually <b>${learned.high ? 'busier' : 'quieter'}</b> than average`
      + (learned.hourAvg != null ? ` (${Math.round(learned.hourAvg)} vs ${Math.round(learned.dayAvg)} members typically)` : '')
      + ` — learned from ${learned.samples} readings.`
    : `Still learning — ${learned.samples}/${traffic.MIN_SAMPLES} readings so far. `
      + `Using your manual peak-hours window (${cfg.servicesPeakStartHour ?? 9}–${cfg.servicesPeakEndHour ?? 22}) until then.`);
  await telegram.say(cfg.telegramChatId, lines.join('\n'), { html: true });
  return { counts, learned };
}

export async function announceNew(cfg) {
  if (!cfg.telegramEnabled || !cfg.telegramChatId) return { skipped: 'off' };

  // The whole "is this new" rule lives in announce.js now, as one pure
  // function proven against the bug history in its own test file - not
  // re-derived here from status/age/tgSentAt separately, which is what let
  // three near-identical copies of this rule drift out of sync with each
  // other over the last dozen releases.
  const all = await getLeads();
  const { send: waiting, stale } = selectQueue(all, cfg);

  // Too old to announce is a decision, not a maybe - stamp them so they are
  // never reconsidered, rather than re-checking the same rows every poll.
  for (const l of stale) await updateLead(l.threadId, { tgSentAt: TOO_OLD });
  if (stale.length) await log(`${stale.length} older thread(s) left off Telegram - they are on the dashboard`);

  if (!waiting.length) return { waiting: 0, stale: stale.length };

  try {
    const t = await telegram.sendLeads(waiting, cfg);
    // ONLY what actually went.
    for (const id of t.sentIds || []) {
      const shown = t.approved?.[String(id)] || {};
      await updateLead(id, {
        tgSentAt: new Date().toISOString(), tgCards: t.cards?.[String(id)],
        // Frozen: this is what goes to the buyer, whatever happens to the lead
        // afterwards.
        dmApproved: shown.dm || '', draftApproved: shown.draft || ''
      });
    }
    const left = waiting.length - (t.sentIds?.length || 0);
    if (t.error) await log(`Telegram: ${t.sent}/${waiting.length} lead(s), ${t.parts} message(s). Failed - ${t.error}`, 'error');
    else if (t.sent) await log(`Telegram: ${t.sent} lead(s) as ${t.parts} message(s)`
      + (left > 0 ? `, ${left} waiting for the next check` : ''));
    return { waiting: waiting.length, sent: t.sent, left };
  } catch (e) {
    // The leads are saved, so nothing is lost - they are still unstamped and
    // will be tried again on the next check.
    await log(`Telegram failed: ${e.message}`, 'error');
    return { waiting: waiting.length, error: e.message };
  }
}


// ---------------------------------------------------------------- v1.1: more sources

/** A lead from a watched forum or the site-wide feed. Public reply only; no draft until you give it one. */
export function enrichThread(item, cfg, { source, bump = false, bumpedAt = null, words = [], bumpWanted = false } = {}) {
  setCardZone(cfg);
  const lead = {
    ...item, kind: 'thread', source: source.key, sourceLabel: source.label,
    intent: intentOf(`${item.title}\n${item.snippet || ''}`),
    watchWords: words.map((w) => w.word), bump, bumpedAt, bumpWanted,
    score: 0, category: source.kind === 'forum' ? 'forum' : 'site', categoryLabel: source.label,
    allCategories: [], matched: words.map((w) => w.word), budget: '', budgetAmount: 0,
    draft: item.draft || '', dm: '', dmTitle: '', dmUrl: '',
    lint: lintDraft(item.draft || '', cfg.compliance), dmLint: null,
    draftedBy: 'you', draftedByNote: '',
    status: 'SENT', foundAt: new Date().toISOString()
  };
  lead.card = buildThreadCard(lead);
  return lead;
}

async function hasIndexed(sourceKey) {
  return Object.values(await getIndex()).some((e) => e.source === sourceKey);
}

function sourceLabelOf(cfg, key) {
  if (!key || key === 'haf') return 'Hire a Freelancer';
  return sourcesOf(cfg).find((s) => s.key === key)?.label || (key === SITE_KEY ? 'Site-wide' : key);
}

/**
 * The watched forums and the site-wide feed, once per check.
 *
 * Runs after the HAF poll so a HAF thread - which the site-wide feed also
 * carries - is already marked seen and stays with its own flow. Every item
 * goes into the search index; only the ones that pass become leads: any new
 * thread on a watched forum, a site-wide thread hitting a watch word, and a
 * bump where you asked for bump alerts. Sales threads never do.
 */
const WALL_KEY = 'sourcesBackoffUntil';
/** Is BHW currently refusing us? Both readers sit out while it is. */
async function walled() {
  const { [WALL_KEY]: until = 0 } = await chrome.storage.local.get(WALL_KEY);
  return Date.now() < until ? until : 0;
}
/** Your IP changed, or you just want to try: forget the wall. */
async function clearWall() { await chrome.storage.local.remove(WALL_KEY); await log('BHW pause cleared by hand - reading again'); }
/** BHW showed a wall (429 / Cloudflare). Stop asking for half an hour; asking again is what makes it longer. */
async function wall(why) {
  const until = Date.now() + 30 * 60000;
  await chrome.storage.local.set({ [WALL_KEY]: until });
  await log(`${why} - pausing every BHW read for 30 minutes, then trying again quietly`, 'error');
}

export async function pollSources({ all = false } = {}) {
  const cfg = await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };
  if (cfg.readMode === 'feeds') return pollSourcesFeeds(cfg);
  const r = await pollWhatsNew(cfg);
  // Automatic: one forum page per check, in turn. By hand: every forum, one
  // after another with a human gap - you pressed the button, you want it all.
  if (!r.skipped) r.forums = await pollForumTurn(cfg, { all }).catch((e) => [{ error: e.message }]);
  return r;
}

/** A listing row as the item shape the rest of the extension uses. */
const rowItem = (r, sourceKey) => ({
  threadId: r.threadId, url: r.url, title: r.title, author: r.author, snippet: '',
  postedAt: r.startedAt || r.lastActivityAt, startedAt: r.startedAt, lastActivityAt: r.lastActivityAt,
  postedAtSource: r.startedAt ? 'listing' : 'unknown', replyCount: r.replyCount,
  forum: r.forum, forumNode: r.forumNode, lastPoster: r.lastPoster || '', source: sourceKey
});

/** Your BHW username: the page says who is signed in; Settings can override. */
async function whoAmI(cfg, page) {
  if (page?.me) await chrome.storage.local.set({ bhwMe: page.me });
  const { bhwMe = '' } = await chrome.storage.local.get('bhwMe');
  return cfg.bhwUsername || page?.me || bhwMe || '';
}

/**
 * Everything on a listing that is worth answering NOW goes into the queue:
 * active within the window (48 h), not a sales thread, not one you have
 * decided, and - if the last post is yours - marked done rather than offered
 * back to you. Quiet: nothing is announced (a first look or a forum page is
 * dozens of threads at once); "next" and the dashboard serve them. `loud(r)`
 * names the exceptions that should reach Telegram - a bump you asked to hear about.
 */
async function queueRecent(cfg, rows, srcOf, { me = '', loud = () => false } = {}) {
  const hours = Number(cfg.threadMaxAgeHours) || 48;
  const cutoff = Date.now() - hours * 3600000;
  const words = watchWordsOf(cfg).filter((w) => w.enabled);
  const existing = new Map((await getLeads()).map((l) => [String(l.threadId), l]));
  const fresh = [], rearm = [];
  let mine = 0, loudN = 0;
  for (const r of rows) {
    if (!r || r.sticky || !r.threadId || !r.url) continue;
    if (String(r.forumNode) === HAF_NODE) continue;
    const act = new Date(r.lastActivityAt || r.startedAt || 0).getTime();
    if (!act || act < cutoff) continue;
    if (isSalesThread(r.title) || isExcludedThread(r, cfg)) continue;
    const src = srcOf(r);
    if (!src) continue;
    const old = existing.get(String(r.threadId));
    if (old && (SILENT_STATUSES.includes(old.status) || old.pmSent)) continue;
    const isMine = !!me && !!r.lastPoster && r.lastPoster.toLowerCase() === me.toLowerCase();
    const bump = !!r.startedAt && Date.now() - new Date(r.startedAt).getTime() > 24 * 3600000;
    const wantLoud = !isMine && loud(r);
    if (old) {
      if (isMine) { await updateLead(old.threadId, { status: 'POSTED', postUrl: r.url, decidedAt: new Date().toISOString(), error: '' }); mine++; }
      else if (wantLoud) rearm.push({ old, r });
      continue;
    }
    const l = enrichThread(rowItem(r, src.key), cfg, {
      source: src, words: src.kind === 'site' ? wordHits(r.title, words) : [],
      bump, bumpedAt: bump ? r.lastActivityAt : null, bumpWanted: true
    });
    if (isMine) { l.status = 'POSTED'; l.postUrl = r.url; l.decidedAt = new Date().toISOString(); mine++; }
    l.card = buildThreadCard(l);
    if (isMine || (!wantLoud && !cfg.pushBacklog)) l.tgSentAt = BASELINE;   // quiet: queue only
    else loudN++;
    fresh.push(l);
  }
  if (fresh.length) await recordLeads(fresh);
  for (const { old, r } of rearm) {
    await updateLead(old.threadId, { bump: true, bumpedAt: r.lastActivityAt, tgSentAt: '', status: 'SENT', lastActivityAt: r.lastActivityAt });
    loudN++;
  }
  await markSeen(rows.filter((r) => r && r.threadId).map((r) => r.threadId));
  return { queued: fresh.length - mine, loud: loudN, mine };
}

/**
 * One watched forum page per check, in turn. What's new only shows the last
 * twenty things on the whole site; a forum's own page shows its bumps for
 * days back. Thirteen forums, one per check, is each forum every ~80 minutes.
 */
async function pollForumTurn(cfg, { all = false } = {}) {
  const forums = sourcesOf(cfg).filter((s) => s.kind === 'forum' && s.enabled);
  if (!forums.length || await walled()) return [];
  const { forumTurn = 0 } = await chrome.storage.local.get('forumTurn');
  const list = all ? forums : [forums[forumTurn % forums.length]];
  if (!all) await chrome.storage.local.set({ forumTurn: (forumTurn + 1) % forums.length });
  const results = [];
  for (const src of list) {
    await new Promise((r) => setTimeout(r, 5000 + Math.random() * 6000));   // a breath between pages
    const one = await readForumPage(cfg, src);
    results.push(one);
    if (one.blocked) break;
  }
  return results;
}

/** One forum's own page: index it, queue what is recent, note what you already answered. */
async function readForumPage(cfg, src) {
  let page;
  try { page = await readListingTab(src.url); }
  catch (e) {
    if (/blocked/i.test(e.message)) { await wall(e.message); return { forum: src.label, error: e.message, blocked: true }; }
    await log(`${src.label} page: ${e.message}`, 'error');
    return { forum: src.label, error: e.message };
  }
  const me = await whoAmI(cfg, page);
  const rows = page.rows.filter((r) => !r.sticky).map((r) => ({ ...r, forumNode: r.forumNode || src.node, forum: r.forum || src.label }));
  const { bumped } = await upsertIndex(rows.map((r) => rowItem(r, src.key)), src.key, { days: cfg.indexDays });
  const bumpedIds = new Set(bumped.map((b) => String(b.threadId)));
  const n = await queueRecent(cfg, rows, () => src, { me, loud: (r) => src.bumpAlerts && bumpedIds.has(String(r.threadId)) });
  await log(`${src.label} page: ${rows.length} row(s), ${n.queued} recent thread(s) queued${n.loud ? `, ${n.loud} announced` : ''}${n.mine ? `, ${n.mine} already answered by you` : ''}`);
  return { forum: src.label, rows: rows.length, ...n };
}


/**
 * Tabs mode. One page - What's new - carries every forum's new and bumped
 * threads with the forum name on each row, so one background tab per check
 * covers all thirteen forums and the watch words at once. HAF rows are left to
 * the HAF poll. Reads are the only other requests, a few per check.
 */
async function pollWhatsNew(cfg) {
  const out = { sources: 0, indexed: 0, leads: 0, bumps: 0, errors: [] };
  const forums = sourcesOf(cfg).filter((s) => s.kind === 'forum' && s.enabled);
  const byNode = new Map(forums.map((f) => [String(f.node), f]));
  const words = watchWordsOf(cfg).filter((w) => w.enabled);
  const siteOn = cfg.siteWideEnabled !== false && words.length > 0;
  const siteSrc = sourcesOf(cfg).find((s) => s.kind === 'site');
  if (!forums.length && !siteOn) return out;
  const until = await walled();
  if (until) return { ...out, skipped: 'backoff', until };

  const seen = await getSeen();
  let rows = [];
  let lastPage = null;
  const pages = Math.max(1, Number(cfg.whatsNewPages) || 1);
  for (let p = 1; p <= pages; p++) {
    let page;
    try { page = await readListingTab(p === 1 ? WHATS_NEW : `${WHATS_NEW}?page=${p}`); }
    catch (e) {
      out.errors.push(e.message);
      if (/blocked/i.test(e.message)) await wall(e.message);
      else await log(`What's new: ${e.message}`, 'error');
      break;
    }
    out.sources = 1;
    lastPage = page;
    if (!page.loggedIn) await logOnce('bhwLogin', 'BlackHatWorld shows you as logged OUT in this Chrome profile - open blackhatworld.com and sign in, or threads cannot be read or posted', 'error');
    else await clearLogOnce('bhwLogin');
    rows = rows.concat(page.rows);
    if (!page.next) break;
    if (p < pages) await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000));
  }
  if (!rows.length) return out;

  const items = rows.filter((r) => !r.sticky).map((r) => ({
    threadId: r.threadId, url: r.url, title: r.title, author: r.author, snippet: '',
    postedAt: r.startedAt || r.lastActivityAt, startedAt: r.startedAt, lastActivityAt: r.lastActivityAt,
    postedAtSource: r.startedAt ? 'listing' : 'unknown', replyCount: r.replyCount,
    forum: r.forum, forumNode: r.forumNode,
    source: byNode.has(String(r.forumNode)) ? byNode.get(String(r.forumNode)).key : SITE_KEY
  }));
  const { fresh, bumped } = await upsertIndex(items, SITE_KEY, { days: cfg.indexDays });
  out.indexed = items.length;

  // First look at What's new: remember what is there, alert on nothing.
  const { whatsNewSeenAt } = await chrome.storage.local.get('whatsNewSeenAt');
  await chrome.storage.local.set({ whatsNewSeenAt: Date.now() });
  if (!whatsNewSeenAt) {
    const me = await whoAmI(cfg, lastPage);
    const srcOf = (r) => byNode.get(String(r.forumNode)) || ((siteOn && wordHits(r.title, words).length) ? siteSrc : null);
    const n = await queueRecent(cfg, rows.filter((r) => !r.sticky), srcOf, { me });
    await log(`What's new: first look, ${items.length} thread(s) indexed, ${n.queued} recent one(s) queued for "next" and the dashboard${n.mine ? `, ${n.mine} already answered by you` : ''} - alerts from now on`);
    return { ...out, queued: n.queued };
  }

  const bumpedIds = new Set(bumped.map((b) => String(b.threadId)));
  const picked = [];
  for (const it of items) {
    if (String(it.forumNode) === HAF_NODE) continue;                    // the HAF poll's job
    const isBump = bumpedIds.has(String(it.threadId))
      || (!!it.startedAt && Date.now() - new Date(it.startedAt).getTime() > 24 * 3600000);
    if (seen[it.threadId] && !isBump) continue;                          // known, and nothing new on it
    if (isExcludedThread(it, cfg) || isSalesThread(it.title)) continue;
    const f = byNode.get(String(it.forumNode));
    const hits = f ? [] : (siteOn ? wordHits(it.title, words) : []);
    if (!f && !hits.length) continue;
    const bumpWanted = f ? f.bumpAlerts : hits.some((w) => w.bumpAlerts);
    if (isBump && !bumpWanted) continue;
    if (isBump && !bumpedIds.has(String(it.threadId)) && seen[it.threadId]) continue;   // old, known, not newly active
    picked.push(enrichThread(it, cfg, { source: f || siteSrc, words: hits, bump: isBump, bumpedAt: isBump ? it.lastActivityAt : null, bumpWanted }));
  }
  if (!picked.length) return out;
  await markSeen(picked.map((l) => l.threadId));

  const full = await withThreads(picked, cfg);
  const before = new Map((await getLeads()).map((l) => [String(l.threadId), l]));
  const kept = [];
  for (const l of full) {
    if (l.replies?.length && !isMarketForum(l.section || l.forum, l.forum)) await addToBank(l);
    if (l.startedAt || l.forum) await patchIndex(l.threadId, { startedAt: l.startedAt || null, forum: l.forum || '', forumNode: l.forumNode || '', section: l.section || '' });
    if (String(l.forumNode) === HAF_NODE) continue;
    if (isMarketForum(l.section || l.forum, l.forum)) continue;
    if (l.startedAt) { l.postedAt = l.startedAt; l.postedAtSource = 'listing'; }
    const old = before.get(String(l.threadId));
    if (l.bump && old && (SILENT_STATUSES.includes(old.status) || old.pmSent)) continue;
    l.card = buildThreadCard(l);
    kept.push(l);
  }
  if (!kept.length) return out;
  await recordLeads(kept);
  for (const l of kept) {
    if (l.bump && before.has(String(l.threadId))) {
      await updateLead(l.threadId, { bump: true, bumpedAt: l.bumpedAt, tgSentAt: '', status: 'SENT', card: l.card });
    }
  }
  out.leads = kept.filter((l) => !l.bump).length;
  out.bumps = kept.filter((l) => l.bump).length;
  await log(`What's new: ${out.leads} new thread(s), ${out.bumps} bump(s) from ${rows.length} row(s)`);
  await playSound(cfg, cfg.sound);
  await notify(`${kept.length} thread(s) to answer · ${kept[0].sourceLabel}`, kept[0].title);
  return out;
}

/** Feeds mode: RSS per forum, a few forums per check. The old way. */
async function pollSourcesFeeds(cfg) {
  const sources = sourcesOf(cfg).filter((s) => s.enabled);
  const words = watchWordsOf(cfg).filter((w) => w.enabled);
  const seen = await getSeen();
  const out = { sources: 0, indexed: 0, leads: 0, bumps: 0, errors: [] };
  const picked = [];

  { const until = await walled(); if (until) return { ...out, skipped: 'backoff', until }; }

  // Round robin: the site-wide feed every check (it holds only 20 items), and
  // a few forums per check in turn. Thirteen forums back to back is what got
  // the 429 in the first place; a forum feed holds hours of activity, so
  // reading each one every ten minutes loses nothing.
  const forums = sources.filter((s) => s.kind === 'forum');
  const per = Math.max(1, Number(cfg.sourcesPerPoll) || 4);
  const { sourceCursor = 0 } = await chrome.storage.local.get('sourceCursor');
  const turn = [];
  for (let i = 0; i < Math.min(per, forums.length); i++) turn.push(forums[(sourceCursor + i) % forums.length]);
  if (forums.length) await chrome.storage.local.set({ sourceCursor: (sourceCursor + turn.length) % forums.length });
  const site = sources.find((s) => s.kind === 'site');
  const round = [...(site && words.length ? [site] : []), ...turn];
  const gap = Math.max(0, Number(cfg.secondsBetweenSourceFetches ?? 2) * 1000);

  for (const src of round) {
    if (out.sources) await new Promise((r) => setTimeout(r, gap + Math.random() * 1000));
    let items;
    try { items = await fetchFeed(src.feedUrl); }
    catch (e) {
      out.errors.push(`${src.label}: ${e.message}`);
      if (/\b429\b/.test(e.message)) { await wall(`${src.label} feed: BHW asked us to slow down (429)`); break; }
      await log(`${src.label} feed: ${e.message}`, 'error');
      continue;
    }
    out.sources++;
    // No listing-page request per forum any more: the feed carries the title,
    // author, snippet and last activity, and reading the thread gives the
    // real start time. Half the requests, same information.
    const rows = items;

    const first = !(await hasIndexed(src.key));
    const { fresh, bumped } = await upsertIndex(rows, src.key, { days: cfg.indexDays });
    out.indexed += rows.length;
    if (first) {
      // First look at a source: remember what is there, alert on nothing.
      await markSeen(rows.map((r) => r.threadId));
      await log(`${src.label}: first look, ${rows.length} thread(s) indexed quietly - new ones from now on`);
      continue;
    }
    for (const it of fresh) {
      if (seen[it.threadId]) continue;                          // HAF or another source has it
      if (isExcludedThread(it, cfg) || isSalesThread(it.title)) continue;
      const hits = src.kind === 'site' ? wordHits(`${it.title}\n${it.snippet || ''}`, words) : [];
      if (src.kind === 'site' && !hits.length) continue;
      const bumpWanted = src.kind === 'forum' ? src.bumpAlerts : hits.some((w) => w.bumpAlerts);
      picked.push({ it, src, hits, bump: false, bumpWanted });
    }
    for (const it of bumped) {
      const hits = src.kind === 'site' ? wordHits(`${it.title}\n${it.snippet || ''}`, words) : [];
      const bumpWanted = src.kind === 'forum' ? src.bumpAlerts : hits.some((w) => w.bumpAlerts);
      if (!bumpWanted) continue;
      if (isExcludedThread(it, cfg) || isSalesThread(it.title)) continue;
      picked.push({ it, src, hits, bump: true, bumpWanted });
    }
  }
  if (!picked.length) return out;

  const leads = picked.map(({ it, src, hits, bump, bumpWanted }) =>
    enrichThread(it, cfg, { source: src, words: hits, bump, bumpedAt: bump ? it.lastActivityAt : null, bumpWanted }));
  await markSeen(leads.map((l) => l.threadId));

  // Read the thread itself: the question, the replies already on it (into
  // the bank), the real start time, and which forum it is actually in.
  const full = await withThreads(leads, cfg);
  const before = new Map((await getLeads()).map((l) => [String(l.threadId), l]));
  const kept = [];
  for (const l of full) {
    // Whatever else happens to it, a thread we read is bank material and the
    // index should know its real start date and forum.
    if (l.replies?.length && !isMarketForum(l.section || l.forum, l.forum)) await addToBank(l);
    if (l.startedAt || l.forum) await patchIndex(l.threadId, { startedAt: l.startedAt || null, forum: l.forum || '', forumNode: l.forumNode || '', section: l.section || '' });
    if (l.forumNode === HAF_NODE) continue;                     // that forum has its own flow
    if (isMarketForum(l.section || l.forum, l.forum)) continue;  // a shop window, not a conversation
    if (l.startedAt) { l.postedAt = l.startedAt; l.postedAtSource = 'thread'; }
    // "New to us" but started more than a day ago: that is a bump we are
    // seeing for the first time, and it only gets through where bumps do.
    if (!l.bump && l.startedAt && Date.now() - new Date(l.startedAt).getTime() > 24 * 3600000) {
      l.bump = true; l.bumpedAt = l.lastActivityAt || new Date().toISOString();
    }
    if (l.bump && !l.bumpWanted) continue;
    const old = before.get(String(l.threadId));
    if (l.bump && old && (SILENT_STATUSES.includes(old.status) || old.pmSent)) continue;   // answered already
    l.card = buildThreadCard(l);
    kept.push(l);
  }
  if (!kept.length) return out;

  await recordLeads(kept);
  // A bump of a thread already in the table must be announced again.
  for (const l of kept) {
    if (l.bump && before.has(String(l.threadId))) {
      await updateLead(l.threadId, { bump: true, bumpedAt: l.bumpedAt, tgSentAt: '', status: 'SENT', card: l.card });
    }
  }
  out.leads = kept.filter((l) => !l.bump).length;
  out.bumps = kept.filter((l) => l.bump).length;
  await log(`sources: ${out.leads} new thread(s), ${out.bumps} bump(s) from ${out.sources} source(s)`);
  await playSound(cfg, cfg.sound);
  const best = kept[0];
  await notify(`${kept.length} thread(s) to answer · ${best.sourceLabel}`, best.title);
  return out;
}

// ---------------------------------------------------------------- v1.1: hunting from Telegram

/**
 * The material pack to Telegram: read the thread first if it never was, bank
 * its replies, then send the question, the replies and the closest past answers.
 */
export async function sendMaterial(lead, cfg) {
  let l = lead;
  if (!l.body && !(l.replies || []).length) {
    const got = cfg.readMode === 'feeds' ? await fetchThread(l.url) : await readThreadTab(l.url).catch(async (e) => { await wall(e.message); return { body: '', replies: [] }; });
    if (got.body || got.replies.length) {
      const patch = { body: got.body, replies: got.replies, startedAt: got.startedAt || l.startedAt, forum: got.forum || l.forum, forumNode: got.forumNode || l.forumNode, section: got.section || l.section };
      await updateLead(l.threadId, patch);
      l = { ...l, ...patch };
      if (got.replies.length && !isMarketForum(l.section || l.forum, l.forum)) await addToBank(l);
    }
  }
  const matches = await bankMatches(`${l.title}\n${l.body || l.snippet || ''}`, { exclude: l.threadId });
  const n = await telegram.sendMany(cfg.telegramChatId, materialMessages({ ...l, tagLabel: l.bump ? 'BUMP' : 'NEW' }, matches));
  await log(`material for "${l.title}": ${n} message(s), ${(l.replies || []).length} reply/replies, ${matches.length} bank match(es)`);
  return { ok: true, sent: n, replies: (l.replies || []).length, matches: matches.length, lead: l };
}

/** Which lead a Telegram message carries, and which half (PM or reply). */
function cardOwner(leads, messageId) {
  const want = Number(messageId);
  if (!want) return null;
  for (const l of leads) {
    for (const [kind, id] of Object.entries(l.tgCards || {})) if (Number(id) === want) return { lead: l, kind };
    for (const h of l.tgHistory || []) if (Number(h.id) === want) return { lead: l, kind: h.kind };
  }
  return null;
}

/** Remember which messages carry this lead's cards, old and new. */
async function stampCards(threadId, cards, patch = {}) {
  const l = (await getLeads()).find((x) => String(x.threadId) === String(threadId));
  const hist = [...(l?.tgHistory || [])];
  const seenId = (mid) => hist.some((h) => Number(h.id) === Number(mid));
  for (const [kind, mid] of Object.entries(l?.tgCards || {})) if (!seenId(mid)) hist.push({ kind, id: mid });
  for (const [kind, mid] of Object.entries(cards || {})) if (!seenId(mid)) hist.push({ kind, id: mid });
  await updateLead(threadId, { tgCards: cards || l?.tgCards, tgHistory: hist.slice(-12), ...patch });
}

/** Put the card back with its buttons and say something underneath, instead of settling (which strips them). */
async function keepCard(tap, lead, cfg, msg) {
  await telegram.editIntoCard(cfg.telegramChatId, tap.messageId, lead, 'reply', cfg).catch(() => {});
  if (msg) await telegram.say(cfg.telegramChatId, msg);
  return '';
}

/**
 * Your own answer. Reply (swipe) to a card with text and that text becomes
 * the post for that thread - or the PM, if the card you replied to was the PM.
 * Then the card shows it, with the Post button.
 */
async function takeAnswerReply(ev, cfg) {
  const own = cardOwner(await getLeads(), ev.replyTo);
  if (!own) return false;
  const { lead, kind } = own;
  let body = String(ev.body || '').trim();
  if (!body) return false;
  const cleaned = stripBotText(body);
  if (!cleaned.text) { await telegram.say(cfg.telegramChatId, '⚠️ That was only my own instructions - nothing was changed.'); return true; }
  body = cleaned.text;
  await setEdit(String(ev.replyTo), null);              // this answers any editor open on that card
  const field = kind === 'PM' ? 'dm' : 'draft';
  const patch = field === 'dm'
    ? { dm: body, dmApproved: body, dmLint: lintDraft(body, cfg.compliance) }
    : { draft: body, draftApproved: body, draftEdited: true, lint: lintDraft(body, cfg.compliance) };
  if (lead.autoPostAt) { patch.autoPostAt = 0; patch.autoBlocked = 'you answered it yourself'; }
  if (lead.autoSendAt) { patch.autoSendAt = 0; patch.autoSendBlocked = 'you answered it yourself'; }
  const fresh = { ...lead, ...patch };
  fresh.card = fresh.kind === 'thread' ? buildThreadCard(fresh) : buildCard(fresh);
  await updateLead(lead.threadId, { ...patch, card: fresh.card });
  const back = await telegram.editIntoCard(cfg.telegramChatId, ev.replyTo, fresh, kind === 'PM' ? 'PM' : 'reply', cfg);
  if (!back) await telegram.resend(fresh, cfg, kind === 'PM' ? 'PM' : 'reply');
  await log(`took your answer for "${lead.title}" from Telegram (${field === 'dm' ? 'PM' : 'public reply'})`);
  return true;
}

const HELP = [
  '🧭 <b>Commands</b>',
  '<b>next</b> / <b>next 3</b> - the next unanswered thread(s), newest first · <b>next reset</b> starts over',
  '<b>haf</b> / <b>haf 24</b> - Hire a Freelancer threads with no DM and no reply yet',
  '<b>casino</b> - every casino thread in the index · <b>casino new</b> / <b>casino bump</b> / <b>casino done</b>',
  '<b>watch casino</b> / <b>watch casino bump</b> / <b>watch &lt;forum url&gt;</b> · <b>unwatch …</b> · <b>watching</b>',
  '<b>seed Google Ads</b> - read that forum\'s recent replies into the answer bank',
  '<b>load Google Ads 2</b> - put that forum\'s last 2 days of threads into the queue for <b>next</b>',
  '<b>push on</b> / <b>push off</b> - also send the swept backlog as cards, or keep it for next',
  '<b>auto</b> - auto mode in numbers: sent today, counting down, left for you and why · <b>auto on</b> / <b>auto off</b>',
  '<b>stats</b> - the dashboard numbers · <b>log</b> / <b>log 30</b> - the dashboard log lines · <b>status</b> · <b>pending</b> · <b>today</b> · <b>digest</b> · <b>auto on/off</b>',
  '',
  'On any card: 📋 <b>Material</b> sends the question, the replies already there, and similar past answers. '
  + 'Write your answer (Claude/ChatGPT on your phone), then <b>reply to the card</b> with it - Chrome posts it when you tap 🚀.'
].join('\n');

async function takeHuntCommand(ev, cfg) {
  const body = String(ev.body || '').trim();
  let m;
  if ((m = body.match(/^\/?next\b\s*(\d+|reset)?\s*$/i))) { await sendNext(cfg, m[1]); return true; }
  if ((m = body.match(/^\/?haf\b\s*(\d+)?\s*$/i))) {
    await sendPending(cfg, m[1] ? Number(m[1]) : (Number(cfg.threadMaxAgeHours) || 48), { only: 'haf' });
    return true;
  }
  if (/^\/?stats\b/i.test(body)) { await sendStats(cfg); return true; }
  if ((m = body.match(/^\/?push\b\s*(on|off)?\s*$/i))) {
    if (m[1]) {
      const on = m[1].toLowerCase() === 'on';
      await setConfig({ pushBacklog: on });
      await telegram.say(cfg.telegramChatId, on
        ? '📨 Push is ON - every thread the sweeps find from the last 48h comes here as a card too, six per check. "push off" to go back to pull.'
        : '📭 Push is OFF - sweeps fill the queue quietly; new and bumped threads still come as cards. Send "next 5" to pull.');
    } else await telegram.say(cfg.telegramChatId, `📨 Push is ${cfg.pushBacklog ? 'ON' : 'OFF'}. Send "push on" or "push off".`);
    return true;
  }
  if ((m = body.match(/^\/?log\b\s*(\d+)?/i))) { await sendLog(cfg, m[1] ? Number(m[1]) : 15); return true; }
  if (/^\/?watching\b/i.test(body)) { await sendWatching(cfg); return true; }
  if ((m = body.match(/^\/?watch\s+(.+)/i))) { await telegram.say(cfg.telegramChatId, await watchCmd(cfg, m[1])); return true; }
  if ((m = body.match(/^\/?unwatch\s+(.+)/i))) { await telegram.say(cfg.telegramChatId, await unwatchCmd(cfg, m[1])); return true; }
  if ((m = body.match(/^\/?seed\s+(.+)/i))) { await seedForum(cfg, m[1]); return true; }
  if ((m = body.match(/^\/?load\s+(.+?)(?:\s+(\d+))?\s*$/i))) {
    const r = await loadForum(cfg, m[1], m[2] ? Number(m[2]) : 2);
    await telegram.say(cfg.telegramChatId, r.error ? `❌ ${r.error}`
      : `📥 ${r.label}: ${r.loaded} thread(s) from the last ${r.days} day(s) added to the queue (${r.scanned} looked at). Send "next" to work through them.`);
    return true;
  }
  if (/^\/?(?:help|commands|start)\b/i.test(body)) { await telegram.say(cfg.telegramChatId, HELP, { html: true }); return true; }
  return false;
}

const UNSTRUCK = (l) => !SILENT_STATUSES.includes(l.status) && !l.pmSent && String(l.threadId) !== 'sample';
const activityOf = (l) => new Date((l.bump && l.bumpedAt) || l.postedAt || l.foundAt || 0).getTime();

/** "next": the queue of unanswered threads, newest first, one page at a time. */
async function sendNext(cfg, arg) {
  if (!cfg.telegramChatId) return;
  const { nextCursor: cur0 } = await chrome.storage.local.get('nextCursor');
  let cur = cur0 && Date.now() - (cur0.at || 0) < 12 * 3600000 ? cur0 : { served: [], at: Date.now() };
  if (String(arg || '').toLowerCase() === 'reset') cur = { served: [], at: Date.now() };
  const n = Math.min(Math.max(1, Number(arg) || 1), 8);
  const hours = Number(cfg.threadMaxAgeHours) || 48;
  const cutoff = Date.now() - hours * 3600000;
  const queue = (await getLeads()).filter((l) => UNSTRUCK(l) && activityOf(l) >= cutoff).sort((a, b) => activityOf(b) - activityOf(a));
  if (!queue.length) { await telegram.say(cfg.telegramChatId, `✅ Queue empty - nothing unanswered from the last ${hours}h.`); return; }
  const todo = queue.filter((l) => !cur.served.includes(String(l.threadId)));
  if (!todo.length) {
    await chrome.storage.local.set({ nextCursor: { served: [], at: Date.now() } });
    await telegram.say(cfg.telegramChatId, `🔁 You have seen all ${queue.length} unanswered thread(s) from the last ${hours}h. `
      + 'Send "next" again to go round once more, or Skip the ones you will not answer.');
    return;
  }
  const batch = todo.slice(0, n);
  const t = await telegram.sendLeads(batch, cfg, { max: n });
  for (const id of t.sentIds || []) {
    const shown = t.approved?.[String(id)] || {};
    const l = batch.find((x) => String(x.threadId) === String(id)) || {};
    await stampCards(id, t.cards?.[String(id)], { tgSentAt: l.tgSentAt || new Date().toISOString(),
      dmApproved: shown.dm || '', draftApproved: shown.draft || '' });
  }
  cur.served.push(...(t.sentIds || []).map(String)); cur.at = Date.now();
  await chrome.storage.local.set({ nextCursor: cur });
  const left = Math.max(0, todo.length - (t.sent || 0));
  await telegram.say(cfg.telegramChatId, `▶️ ${t.sent || 0} sent · ${left} more unanswered in the last ${hours}h.`
    + (left ? ' Send "next" for the next one, "next 3" for three.' : ''));
}

const SEARCH_BATCH = 8;

/**
 * A word on its own is a search: "casino", "casino new", "casino bump",
 * "casino done". Results come as cards, newest activity first, a page at a
 * time - the same query again continues where it left off.
 */
async function takeSearch(ev, cfg) {
  const raw = String(ev.body || '').trim();
  if (!raw || raw.startsWith('/')) return false;
  const words = raw.split(/\s+/);
  if (words.length > 6 || raw.length > 80) {
    await telegram.say(cfg.telegramChatId, '✍️ To use that as an answer, reply to the thread card (swipe it, or tap ✍️ My answer first). '
      + 'To search, send a word or two: "casino", "casino bump". Send "help" for everything.');
    return true;
  }
  let mode = 'all';
  const last = words[words.length - 1].toLowerCase();
  if (words.length > 1 && ['new', 'bump', 'bumped', 'done'].includes(last)) { mode = last === 'bumped' ? 'bump' : last; words.pop(); }
  const query = words.join(' ');
  const leads = await getLeads();
  const found = await searchIndex(query, { mode, leads, limit: 200 });
  if (!found.length) {
    await telegram.say(cfg.telegramChatId, `🔎 Nothing for "${query}"${mode !== 'all' ? ` (${mode})` : ''} in the last ${cfg.indexDays || 7} days. `
      + `The index only holds threads seen since install. "watch ${query}" makes every new one come here.`);
    return true;
  }
  const { searchCursor: cur } = await chrome.storage.local.get('searchCursor');
  let offset = cur && cur.query === query && cur.mode === mode && Date.now() - cur.at < 3600000 ? cur.offset : 0;
  if (offset >= found.length) offset = 0;
  const page = found.slice(offset, offset + SEARCH_BATCH);
  await chrome.storage.local.set({ searchCursor: { query, mode, offset: offset + page.length, at: Date.now() } });

  const byId = new Map(leads.map((l) => [String(l.threadId), l]));
  const batch = [], made = [];
  for (const e of page) {
    let l = byId.get(String(e.threadId));
    if (!l) {
      const src = { key: e.source || SITE_KEY, label: sourceLabelOf(cfg, e.source), kind: String(e.source || '').startsWith('forum:') ? 'forum' : 'site' };
      l = enrichThread({ threadId: e.threadId, url: e.url, title: e.title, author: e.author, snippet: e.snippet,
                         postedAt: e.startedAt || e.lastActivityAt, lastActivityAt: e.lastActivityAt,
                         postedAtSource: e.startedAt ? 'listing' : 'feed', startedAt: e.startedAt, forum: e.forum, forumNode: e.forumNode },
                       cfg, { source: src, bump: e.tag === 'BUMP', bumpedAt: e.bumpedAt || null, bumpWanted: true });
      made.push(l);
    } else if (l.kind === 'thread') {
      l = { ...l, bump: e.tag === 'BUMP' || !!l.bump, bumpedAt: l.bumpedAt || e.bumpedAt || null };
    }
    l = { ...l, searchTag: e.tag };
    if (l.kind === 'thread') l.card = buildThreadCard(l);
    batch.push(l);
  }
  if (made.length) await recordLeads(made);
  const t = await telegram.sendLeads(batch, cfg, { max: SEARCH_BATCH });
  for (const id of t.sentIds || []) {
    const shown = t.approved?.[String(id)] || {};
    const l = batch.find((x) => String(x.threadId) === String(id)) || {};
    await stampCards(id, t.cards?.[String(id)], { tgSentAt: l.tgSentAt || new Date().toISOString(),
      dmApproved: shown.dm || '', draftApproved: shown.draft || '' });
  }
  const tally = (tag) => found.filter((e) => e.tag === tag).length;
  const left = found.length - offset - page.length;
  await telegram.say(cfg.telegramChatId, `🔎 "${query}"${mode !== 'all' ? ` · ${mode}` : ''}: ${t.sent || 0} of ${found.length} `
    + `(${tally('NEW')} new · ${tally('BUMP')} bump · ${tally('DONE')} done)`
    + (left > 0 ? ` - send it again for the next ${Math.min(SEARCH_BATCH, left)}.` : ' - that is all of them.'));
  return true;
}

/** When the last check ran, when the next is due, and whether BHW has us paused. */
async function checkLine(cfg) {
  const { lastPollAt = 0, whatsNewSeenAt = 0 } = await chrome.storage.local.get(['lastPollAt', 'whatsNewSeenAt']);
  const ago = (t) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 60000))} min ago` : 'never');
  const until = await walled();
  let alarm = null;
  try { alarm = await chrome.alarms.get(FEED_ALARM); } catch { /* no alarms API */ }
  const next = alarm?.scheduledTime ? `${Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 60000))} min` : '?';
  return `Checks: last ${ago(lastPollAt)} · What's new ${ago(whatsNewSeenAt)} · next in ${next}`
    + (until ? ` · ⏸ paused by a BHW wall until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
}

/** The dashboard log, on your phone. */
async function sendLog(cfg, n = 15) {
  const lines = (await getLog()).slice(0, Math.min(40, Math.max(1, n)));
  if (!lines.length) { await telegram.say(cfg.telegramChatId, 'The log is empty.'); return; }
  const text = lines.map((e) => `${e.level === 'error' ? '❗' : '·'} ${String(e.t).slice(11, 16)} ${escHtml(e.msg)}`).join('\n');
  await telegram.say(cfg.telegramChatId, `🧾 <b>Last ${lines.length} log line(s)</b> (newest first, UTC)\n${text}`.slice(0, 3900), { html: true });
}

async function sendStats(cfg) {
  const leads = await getLeads();
  const day = new Date().toLocaleDateString('en-CA');
  const on = (t) => String(t || '').slice(0, 10) === day;
  const today = leads.filter((l) => on(l.foundAt));
  const haf = today.filter((l) => l.kind !== 'thread').length;
  const forums = today.filter((l) => l.kind === 'thread' && String(l.source).startsWith('forum:')).length;
  const site = today.filter((l) => l.kind === 'thread' && l.source === SITE_KEY).length;
  const posted = leads.filter((l) => l.status === 'POSTED' && on(l.decidedAt || l.foundAt)).length;
  const pms = leads.filter((l) => l.pmSent && on(l.pmSentAt)).length;
  const hours = Number(cfg.threadMaxAgeHours) || 48;
  const cutoff = Date.now() - hours * 3600000;
  const waiting = leads.filter((l) => UNSTRUCK(l) && activityOf(l) >= cutoff).length;
  const idx = await indexStats();
  const bank = await bankStats();
  const r = await getRateState();
  const srcs = sourcesOf(cfg).filter((s) => s.enabled && s.kind === 'forum').map((s) => s.label);
  const words = watchWordsOf(cfg).filter((w) => w.enabled).map((w) => w.word);
  const cap = (used, max) => (Number(max) > 0 ? `${used}/${max}` : `${used}`);
  await telegram.say(cfg.telegramChatId, [
    '📊 <b>Hunt today</b>',
    `Found: ${haf} HAF · ${forums} forum · ${site} site-wide`,
    `Answered: ${posted} posted · ${pms} PM${pms === 1 ? '' : 's'}`,
    `Waiting: ${waiting} unanswered from the last ${hours}h - send "next"`,
    `Caps: ${cap(r.count || 0, cfg.maxPostsPerDay)} replies · ${cap(r.dmCount || 0, cfg.maxDmsPerDay)} PMs`,
    `Index: ${idx.size} threads (${idx.bumped} bumped) · Bank: ${bank.threads} threads / ${bank.replies} replies`,
    `Watching: ${escHtml(srcs.join(', ') || 'no forums')} · words: ${escHtml(words.join(', ') || 'none')}`,
    await checkLine(cfg)
  ].join('\n'), { html: true });
}

async function watchCmd(cfg, raw) {
  const arg = String(raw || '').trim();
  const bump = /\bbump\b/i.test(arg);
  const target = arg.replace(/\bbump\b/ig, '').trim();
  const url = normalizeForumUrl(target);
  if (url) {
    if (forumNodeOf(url) === HAF_NODE) return 'That is Hire a Freelancer - already watched, always.';
    const list = (cfg.watchForums || []).filter((f) => normalizeForumUrl(f.url) !== url);
    const label = labelFromUrl(url);
    list.push({ url, label, enabled: true, bumpAlerts: bump });
    await setConfig({ watchForums: list });
    return `👀 Watching forum "${label}"${bump ? ' with bump alerts' : ''}. Its first look indexes quietly; new threads after that come here. "seed ${label}" fills the answer bank from it.`;
  }
  if (!target) return '❌ Send a forum URL or a word: "watch casino", "watch casino bump", or "watch https://www.blackhatworld.com/forums/x.83/".';
  const list = (cfg.watchWords || []).filter((w) => String(w.word).toLowerCase() !== target.toLowerCase());
  list.push({ word: target, enabled: true, bumpAlerts: bump });
  await setConfig({ watchWords: list, siteWideEnabled: true });
  return `👀 Watching the whole site for "${target}"${bump ? ' with bump alerts' : ''}. Send "${target}" any time to search what is already indexed.`;
}

async function unwatchCmd(cfg, raw) {
  const t = String(raw || '').trim().toLowerCase();
  const url = normalizeForumUrl(t);
  const forums = (cfg.watchForums || []).filter((f) =>
    !(normalizeForumUrl(f.url) === url || String(f.label || '').toLowerCase() === t || labelFromUrl(f.url).toLowerCase() === t));
  const words = (cfg.watchWords || []).filter((w) => String(w.word).toLowerCase() !== t);
  const removed = ((cfg.watchForums || []).length - forums.length) + ((cfg.watchWords || []).length - words.length);
  if (!removed) return `❌ Nothing called "${raw}" is being watched. Send "watching" for the list.`;
  await setConfig({ watchForums: forums, watchWords: words });
  return `🗑️ Stopped watching "${String(raw).trim()}".`;
}

async function sendWatching(cfg) {
  const srcs = sourcesOf(cfg).filter((s) => s.kind === 'forum');
  const words = watchWordsOf(cfg);
  const lines = ['👀 <b>Watching</b>', '• Hire a Freelancer (always)'];
  for (const s of srcs) lines.push(`• ${escHtml(s.label)} - ${s.enabled ? 'on' : 'off'}${s.bumpAlerts ? ', bump alerts' : ''}\n  ${escHtml(s.url)}`);
  lines.push(`Site-wide feed: ${cfg.siteWideEnabled !== false ? 'on' : 'off'} - words: `
    + (words.length ? words.map((w) => `${escHtml(w.word)}${w.bumpAlerts ? ' (bump)' : ''}${w.enabled ? '' : ' (off)'}`).join(', ') : 'none yet - "watch casino"'));
  await telegram.say(cfg.telegramChatId, lines.join('\n'), { html: true });
}

/**
 * "load <forum> [days]": the last N days of a watched forum, straight into the
 * queue - not announced (that would be a flood), but "next" and search serve
 * them. For the first day, and for a forum you only just added.
 */
export async function loadForum(cfg, raw, days = 2) {
  const t = String(raw || '').trim().toLowerCase();
  const src = sourcesOf(cfg).find((s) => s.kind === 'forum' && (s.label.toLowerCase() === t || normalizeForumUrl(t) === s.url || s.node === t));
  if (!src) return { error: `No watched forum matches "${raw}". Send "watching" for the list.` };
  const span = Math.max(1, Number(days) || 2);
  const from = Date.now() - span * 86400000;
  let pages = 0, listing = {};
  for (const step of [2, 2, 3, 3]) {
    pages += step;
    listing = cfg.readMode === 'feeds' ? await fetchListingPages(src.url, pages, {}) : await readListingPages(src.url, pages);
    const times = Object.values(listing).map((r) => (r.startedAt ? new Date(r.startedAt).getTime() : NaN)).filter(isFinite);
    if (!times.length || Math.min(...times) <= from) break;
    if (Object.keys(listing).length < pages * 5) break;
  }
  const existing = new Set((await getLeads()).map((l) => String(l.threadId)));
  const rows = Object.values(listing).filter((r) => r.threadId && r.url && r.startedAt
    && new Date(r.startedAt).getTime() >= from && !existing.has(String(r.threadId))
    && !isSalesThread(r.title) && !isExcludedThread(r, cfg));
  const items = rows.map((r) => ({ threadId: r.threadId, url: r.url, title: r.title, author: r.author, snippet: '',
    postedAt: r.startedAt, startedAt: r.startedAt, lastActivityAt: r.lastActivityAt, postedAtSource: 'listing', replyCount: r.replyCount }));
  await upsertIndex(items, src.key, { days: cfg.indexDays });
  const leads = items.map((it) => enrichThread(it, cfg, { source: src, words: [] }));
  await markSeen(leads.map((l) => l.threadId));
  if (leads.length) {
    await recordLeads(leads);
    for (const l of leads) await updateLead(l.threadId, { tgSentAt: BASELINE });   // never auto-announced
  }
  await log(`${src.label}: loaded ${leads.length} thread(s) from the last ${span} day(s) (${pages} page(s) read)`);
  return { ok: true, loaded: leads.length, scanned: Object.keys(listing).length, pages, days: span, label: src.label };
}

/** "seed <forum>": read that forum's recent replied threads into the answer bank, at a human pace. */
async function seedForum(cfg, raw) {
  const t = String(raw || '').trim().toLowerCase();
  const src = sourcesOf(cfg).find((s) => s.kind === 'forum' && (s.label.toLowerCase() === t || normalizeForumUrl(t) === s.url || s.node === t));
  if (!src) { await telegram.say(cfg.telegramChatId, `❌ No watched forum matches "${raw}". Send "watching" for the list.`); return; }
  await telegram.say(cfg.telegramChatId, `🌱 Seeding the answer bank from "${src.label}" - reading up to 15 recent threads with replies, at a human pace…`);
  let listing = {};
  try { listing = cfg.readMode === 'feeds' ? await fetchListingPages(src.url, 2) : await readListingPages(src.url, 2); }
  catch (e) { await telegram.say(cfg.telegramChatId, `❌ Could not read the forum: ${e.message}`); return; }
  const rows = Object.values(listing).filter((r) => r.url && (r.replyCount || 0) > 0).slice(0, 15);
  const got = cfg.readMode === 'feeds' ? await fetchThreads(rows, { max: 15, delayMs: 2000 })
    : await readThreadsInTabs(rows, { max: 10, gapMs: Math.max(2, Number(cfg.threadReadGapSeconds) || 8) * 1000 });
  if (got.__blocked) { await wall(got.__blocked); delete got.__blocked; }
  let added = 0;
  for (const r of rows) {
    const th = got[r.threadId];
    if (!th?.replies?.length) continue;
    const a = await addToBank({ threadId: r.threadId, title: r.title, url: r.url, forum: th.forum || src.label, body: th.body, replies: th.replies });
    if (a.added) added++;
  }
  await upsertIndex(rows.map((r) => ({ threadId: r.threadId, url: r.url, title: r.title, author: r.author, snippet: '',
    postedAt: r.startedAt, lastActivityAt: r.lastActivityAt, startedAt: r.startedAt })), src.key, { days: cfg.indexDays });
  const b = await bankStats();
  await telegram.say(cfg.telegramChatId, `🌱 Done: ${added} thread(s) added. The bank now holds ${b.threads} threads / ${b.replies} replies.`);
}

export async function pollFeed() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };
  await chrome.storage.local.set({ lastPollAt: Date.now() });

  // Tabs mode: the forum page itself, in a background tab, gives the rows AND
  // the reply counts and start dates in one go. Feeds mode: RSS, then the
  // listing page, as before.
  let items, preListing = null;
  if (cfg.readMode === 'feeds') items = await fetchFeed(cfg.feedUrl);
  else {
    const until = await walled();
    if (until) return { skipped: 'backoff', until };
    let page;
    try { page = await readListingTab(forumUrlFromFeed(cfg.feedUrl)); }
    catch (e) { if (/blocked/i.test(e.message)) await wall(e.message); throw e; }
    if (!page.loggedIn) await logOnce('bhwLogin', 'BlackHatWorld shows you as logged OUT in this Chrome profile - open blackhatworld.com and sign in, or threads cannot be read or posted', 'error');
    else await clearLogOnce('bhwLogin');
    items = page.rows.filter((r) => !r.sticky).map((r) => ({
      threadId: r.threadId, url: r.url, title: r.title, author: r.author, snippet: '',
      postedAt: r.startedAt || r.lastActivityAt || new Date().toISOString(), lastActivityAt: r.lastActivityAt,
      postedAtSource: r.startedAt ? 'listing' : 'feed', replyCount: r.replyCount
    }));
    preListing = Object.fromEntries(page.rows.map((r) => [r.threadId, { replyCount: r.replyCount, startedAt: r.startedAt, lastActivityAt: r.lastActivityAt, sticky: r.sticky }]));
  }
  const seen = await getSeen();
  const fresh = items.filter((i) => !seen[i.threadId]);

  // First run: nothing goes to Telegram, but the last backfillHours of threads
  // are recorded in the Sheet so the database starts with history, not empty.
  if (await isFirstRun()) {
    const cutoff = Date.now() - (cfg.backfillHours || 0) * 3600000;
    const recent = items.filter((i) => new Date(i.postedAt).getTime() >= cutoff);
    const listing = preListing || (recent.length ? await fetchListing(forumUrlFromFeed(cfg.feedUrl)) : {});
    const backfill = recent
      .map((raw) => withListing(raw, listing[raw.threadId]))
      .filter((item) => !isExcludedThread(item, cfg))
      .map((item) => {
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
  const listing = preListing || await fetchListing(forumUrlFromFeed(cfg.feedUrl));
  await updateReplyCounts(Object.fromEntries(
    Object.entries(listing).map(([id, v]) => [id, v.replyCount]).filter(([, c]) => c != null)));

  if (!fresh.length) return { new: 0, matched: 0 };

  // Every new thread goes through. matchLead only decides category/score;
  // an unmatched thread still gets sent with score 0 and a generic draft. A
  // mod/rules/sticky thread never gets this far - see isExcludedThread - so
  // it never becomes a lead, never buzzes your phone, and never sits on the
  // dashboard looking like something you missed.
  const matched = fresh
    .map((raw) => withListing(raw, listing[raw.threadId]))
    .filter((item) => !isExcludedThread(item, cfg))
    .map((item) => matchLead(item, cfg) || { ...item, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 })
    .filter((m) => m.score >= cfg.notifyScore);

  // Read each thread before drafting, so the reply answers the post rather than
  // the title, and knows what the competition has already promised.
  const full = await withThreads(matched, cfg);

  // One batched request for the whole poll, so the instructions are paid for
  // once rather than once per lead. Falls back to the built-in rules.
  const { specifics: ai, note: aiNote } = await specificsFor(full, cfg);
  const leads = full.map((m) => {
    const got = ai[m.threadId];
    // Claude was asked for this batch and this lead did not get an answer -
    // budget, a bad key, a network error. The built-in rules still write a
    // real draft so nothing is ever blank, but it is generic, and nothing
    // about the message itself says so - the card has to, which means this
    // has to reach enrich() BEFORE it builds the card, not be patched on after.
    const note = !got && cfg.aiSpecifics ? (aiNote || 'Claude did not write this one') : '';
    const lead = enrich(m, cfg, 'SENT', got, note);
    if (got) lead.aiFrom = sourceOf(m);
    return lead;
  });
  await markSeen(fresh.map((i) => i.threadId));

  if (!leads.length) return { new: fresh.length, matched: 0 };

  await recordLeads(leads);

  // Night mode: arm the countdown BEFORE Telegram, so the card that reaches
  // your phone already says when it will post and carries the Hold button.
  if (night.isNight(cfg)) {
    const armed = [];
    for (const l of leads) {
      const why = night.blockedReason(l, cfg);
      if (why) { l.autoBlocked = why; continue; }
      l.autoPostAt = night.postAt(cfg);
      armed.push(l);
    }
    if (armed.length) {
      for (const l of armed) await updateLead(l.threadId, { autoPostAt: l.autoPostAt, autoBlocked: '' });
      await log(`night mode: ${armed.length} reply/replies posting in ${cfg.nightVetoMinutes} min unless held`);
    }
    const held = leads.filter((l) => l.autoBlocked);
    for (const l of held) await updateLead(l.threadId, { autoBlocked: l.autoBlocked });
  }
  if (cfg.autoMode) {
    // Auto mode: the PRIVATE MESSAGE sends itself 1-3 minutes after a new HAF
    // thread is found, if Claude's screen passed - see src/auto.js. Nothing
    // public is armed here, ever. Independent of night mode: different message.
    const armed = [];
    for (const l of leads) {
      const why = auto.blockedReason(l, cfg);
      if (why) { l.autoSendBlocked = why; continue; }
      l.autoSendAt = auto.postAt(cfg);
      armed.push(l);
    }
    if (armed.length) {
      for (const l of armed) await updateLead(l.threadId, { autoSendAt: l.autoSendAt, autoSendBlocked: '' });
      await log(`auto mode: ${armed.length} PM(s) sending in 1-3 min unless held`);
    }
    const held = leads.filter((l) => l.autoSendBlocked);
    for (const l of held) await updateLead(l.threadId, { autoSendBlocked: l.autoSendBlocked });
    if (held.length) await log(`auto mode: ${held.length} thread(s) left for you - ${held.slice(0, 3).map((l) => l.autoSendBlocked).join('; ')}`);
  }

  // Announcing is runCheck's job now - it has to happen on the quiet polls too,
  // and doing it here as well would just read the table twice.

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
  }).filter((r) => !isExcludedThread(r, cfg));

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
/**
 * When the tap check last ran, and what it found.
 *
 * The single most useful fact when nothing is happening. If this is minutes or
 * hours old, the extension is not running at all - Chrome closed, the machine
 * asleep, the worker dead - and no amount of checking tokens will help. If it
 * is seconds old and still nothing arrives, the problem is at Telegram's end
 * or in the chat id. Those need different fixes, and this is what tells them
 * apart.
 */
const BEAT_KEY = 'tapsHeartbeat';
const beat = (r) => chrome.storage.local.set({ [BEAT_KEY]: { at: Date.now(), ...r } });
export const tapsHeartbeat = async () => (await chrome.storage.local.get(BEAT_KEY))[BEAT_KEY] || null;

/** What each button tap is actually doing, for the card's "in progress" state. */
const TAP_VERBS = {
  p: 'Posting', d: 'Sending the PM', f: 'Sending the PM',
  s: 'Skipping', h: 'Holding', e: 'Opening the editor', m: 'Opening the editor', o: 'Sending the material'
};

export async function pollTaps() {
  const cfg = await getConfig();

  // The three ways this can be dead on arrival - all of which used to return
  // in silence. A fresh install on a new machine has an empty vault, so the
  // buttons on your phone go to a Chrome that is not listening: Telegram shows
  // no error (it delivered the tap and is waiting for an answer that never
  // comes) and Chrome does nothing. Now the log says which piece is missing.
  const missing = !cfg.telegramApprovals
    ? 'Telegram approvals are switched off in Settings, so your button taps are not being collected.'
    : !(await telegram.hasToken())
      ? 'No Telegram bot token is saved on this install, so your button taps cannot be collected. '
        + 'Settings → paste the token, or Restore from a file.'
      : !cfg.telegramChatId
        ? 'No Telegram chat id is saved on this install, so your button taps are being ignored. '
          + 'Settings → Find it for me, or Restore from a file.'
        : '';
  if (missing) {
    await beat({ ok: false, note: missing });
    await logOnce('tapsOff', `Telegram buttons will not work: ${missing}`, 'error');
    return { skipped: 'off', reason: missing };
  }
  await clearLogOnce('tapsOff');

  let events;
  try { events = await telegram.pendingTaps(); }
  catch (e) {
    await beat({ ok: false, note: e.message });
    await log(`Telegram taps could not be read: ${e.message}`, 'error');
    return { error: e.message };
  }
  await beat({ ok: true, note: events.length ? `${events.length} waiting` : 'nothing waiting' });
  if (!events.length) return { taps: 0 };

  let done = 0;
  // Lead-posting taps (post the reply, send the PM) are claimed and marked
  // "working" as soon as they are found, below, but the actual slow work is
  // deferred to here and run one at a time afterward - see the comment where
  // they are queued.
  const queued = [];
  for (const ev of events) {
    if (ev.chatId && String(ev.chatId) !== String(cfg.telegramChatId)) {
      await log(`ignored a Telegram ${ev.kind} from chat ${ev.chatId}, which is not yours`, 'error');
      if (ev.kind === 'tap') await telegram.ackTap(ev.id, 'Not your chat.');
      continue;
    }

    // Typed commands, answered before anything treats the message as a rewrite.
    if (ev.kind === 'reply' && /^\/?status\b/i.test(String(ev.body || '').trim())) {
      await telegram.say(cfg.telegramChatId, await statusReport(cfg), { html: true });
      done++;
      continue;
    }

    // "Show me what I haven't finished" - a manual audit, not another
    // automatic feed. Deliberately does not use announce.js's rules: those
    // exist to stop AUTOMATIC notifications repeating or reaching back
    // through history, which is the opposite of what asking for this on
    // purpose wants. It matches the dashboard's own "still struck-through or
    // not" test exactly, so what you see here is what you would see there -
    // including a History-labelled lead, since those are exactly the ones a
    // "did something get missed" audit exists to catch.
    //
    // Bare "pending" defaults to the last 24 hours - old leads from days ago
    // kept surfacing otherwise, which is the opposite of "what did I just
    // miss". "pending 6" or "pending 48" narrows or widens that window, and
    // "pending 0" is the explicit way back to the whole table, unfiltered.
    {
      const pm = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?(?:pending|todo|missed)\b\s*(\d+)?/i);
      if (pm) {
        await sendPending(cfg, pm[1] ? Number(pm[1]) : 24);
        done++;
        continue;
      }
    }

    // "today" - the recap, with links, of what actually went out.
    if (ev.kind === 'reply' && /^\/?today\b/i.test(String(ev.body || '').trim())) {
      await sendToday(cfg);
      done++;
      continue;
    }

    // "digest" or "digest 14" - found/posted/PM'd per day, last N days (7 default).
    {
      const dm = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?digest\b\s*(\d+)?/i);
      if (dm) {
        await sendDigest(cfg, dm[1] ? Number(dm[1]) : 7);
        done++;
        continue;
      }
    }

    // "auto" / "auto on" / "auto off" - toggle unattended posting of public
    // replies. Same rule everywhere else in the extension: a PM is never
    // sent without a tap, whatever this is set to.
    {
      const am = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?auto\b\s*(on|off)?\s*$/i);
      if (am) {
        if (am[1]) {
          const on = am[1].toLowerCase() === 'on';
          // Night mode is the one other thing that can post without a tap, and what
          // it posts is the PUBLIC reply. Your rule is that nothing public is ever
          // automated, so switching auto mode on switches that off.
          const nightWasOn = on && !!cfg.nightMode;
          await setConfig(on ? { autoMode: true, autoModeSince: new Date().toISOString(), nightMode: false } : { autoMode: false });
          if (nightWasOn) {
            for (const l of (await getLeads()).filter((x) => x.autoPostAt)) await updateLead(l.threadId, { autoPostAt: 0, autoBlocked: 'night mode was switched off' });
            await log('night mode switched off with auto mode on: no public reply is posted automatically');
          }
          if (!on) {
            // Off means off: anything already counting down stops too.
            for (const l of auto.pending(await getLeads()).concat(auto.dueNow(await getLeads()))) {
              await updateLead(l.threadId, { autoSendAt: 0, autoSendBlocked: 'auto mode was switched off' });
            }
          }
          const ai = on ? await aiStatus().catch(() => null) : null;
          const noKey = on && !(ai && ai.configured && ai.enabled !== false);
          await telegram.say(cfg.telegramChatId, on
            ? '⚡ Auto mode is ON — for every NEW Hire a Freelancer thread from now on, the private message sends itself '
              + '1-3 min after it is found, if Claude screened it as a real buyer. Tap ✋ Hold on a card to stop that one. '
              + 'Public replies are never posted automatically.'
              + (nightWasOn ? ' Night mode was on and has been switched off for that reason.' : '')
              + (noKey ? '\n\n⚠️ Claude is not available on this install (no key saved, or switched off), so NOTHING will send until you add the key in Settings. That is the rule working: no Claude screen, no PM.' : '')
            : '⚡ Auto mode is OFF — nothing sends by itself, and any countdown in progress was stopped. Everything waits for your tap.');
        } else {
          await telegram.say(cfg.telegramChatId, await autoReport(cfg), { html: true });
        }
        done++;
        continue;
      }
    }

    // "exclude <thread url or id>" - never treat this thread as a lead again,
    // and clear out any copy already sitting in the table. For a mod/rules
    // thread a sticky check misses, or any other thread you never want to see.
    {
      const em = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?exclude\s+(\S+)/i);
      if (em) {
        const id = threadIdFromUrl(em[1]) || em[1].replace(/\D/g, '');
        if (!id) {
          await telegram.say(cfg.telegramChatId, '❌ Could not find a thread id in that - send a thread URL or its numeric id.');
        } else {
          const ids = new Set((cfg.excludeThreadIds || []).map(String));
          ids.add(String(id));
          const next = await setConfig({ excludeThreadIds: [...ids] });
          const swept = await settleExcludedLeads(next);
          await telegram.say(cfg.telegramChatId,
            `🚫 Thread ${id} will never be recorded as a lead again.`
            + (swept.settled ? ` Cleared ${swept.settled} copy already in the table.` : ''));
        }
        done++;
        continue;
      }
    }

    // "track <thread url> <label>" - add one of YOUR OWN service threads to
    // the bump tracker. "untrack <label>" removes it. "services" lists them
    // all with their bump-eligibility countdown. "bumped <label>" - you
    // posted the suggested update yourself; reset the clock.
    {
      const trm = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?track\s+(\S+)(?:\s+(.+))?/i);
      if (trm) {
        const r = await trackServiceThread(cfg, trm[1], trm[2]);
        await telegram.say(cfg.telegramChatId, r.ok
          ? `🧵 Tracking "${r.label}" — you'll hear about it here once it's due to bump.`
          : `❌ ${r.error}`);
        done++;
        continue;
      }
    }
    {
      const utm = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?untrack\s+(.+)/i);
      if (utm) {
        const r = await untrackServiceThread(cfg, utm[1]);
        await telegram.say(cfg.telegramChatId, r.removed
          ? `🗑️ Stopped tracking "${r.thread.label}".`
          : `❌ No tracked thread matches "${utm[1].trim()}".`);
        done++;
        continue;
      }
    }
    if (ev.kind === 'reply' && /^\/?services\b/i.test(String(ev.body || '').trim())) {
      await sendServicesStatus(cfg);
      done++;
      continue;
    }
    // "traffic" - the live BHW online count right now, and whether this hour
    // is actually busier than average once enough real data exists.
    if (ev.kind === 'reply' && /^\/?traffic\b/i.test(String(ev.body || '').trim())) {
      await sendTrafficStatus(cfg);
      done++;
      continue;
    }
    {
      const bm = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?bumped\s+(.+)/i);
      if (bm) {
        const r = await markBumped(cfg, bm[1]);
        await telegram.say(cfg.telegramChatId, r.marked
          ? `✅ "${r.thread.label}" marked bumped — eligible again in ${services.PROMO_BUMP_HOURS}h.`
          : `❌ No tracked thread matches "${bm[1].trim()}".`);
        done++;
        continue;
      }
    }
    // "idea <label>" - suggested bump wording for a tracked thread, on
    // request, at any time. Unlike the automatic due+peak-hour reminder,
    // this never touches bumpNotifiedAt or the eligibility clock.
    {
      const im = ev.kind === 'reply' && String(ev.body || '').trim().match(/^\/?idea\s+(.+)/i);
      if (im) {
        await sendBumpIdea(cfg, im[1]);
        done++;
        continue;
      }
    }

    // v1.1: hunting commands, then a reply to a card as your own answer, then
    // an open editor, then a bare word as a search.
    if (ev.kind === 'reply') {
      if (await takeHuntCommand(ev, cfg)) { done++; continue; }
      if (ev.replyTo && await takeAnswerReply(ev, cfg)) { done++; continue; }
      if (await takeRewrite(ev, cfg)) { done++; continue; }
      if (await takeSearch(ev, cfg)) done++;
      continue;
    }

    // The "in progress" placeholder itself. markWorking swaps the real
    // buttons for this one specifically so a second tap during the job lands
    // somewhere harmless instead of on a button that no longer means what it
    // says.
    if (ev.action === 'noop') {
      await telegram.ackTap(ev.id, 'Still working on it - this will update when it is done.');
      continue;
    }

    // The self-test button belongs to no lead. Answer it here, before anything
    // tries to look one up.
    if (ev.action === 't') {
      await telegram.ackTap(ev.id, 'Got it.');
      await chrome.storage.local.set({ tgSelfTestAt: Date.now() });
      await telegram.settleTap(ev, '✅ Your taps reach Chrome. Everything is connected - '
        + 'Post Public Now, Post DM Now and the Edit buttons will all work.');
      await log('Telegram self-test passed: a tap reached Chrome');
      done++;
      continue;
    }

    const all = await getLeads();
    const lead = all.find((l) => String(l.threadId) === String(ev.threadId));
    if (!lead) {
      // An empty table means a different install answered this tap than the
      // one that sent it - moving Chrome to another machine does exactly this,
      // because the leads live in that machine's storage, not in the message.
      const why = all.length
        ? 'That lead is no longer in the table.'
        : 'This Chrome has no leads yet, so it cannot post that one. It is a fresh install - let it run one check first.';
      await telegram.ackTap(ev.id, why);
      if (!all.length) await logOnce('tapNoLeads', `a Telegram tap arrived for thread ${ev.threadId} but this install has no leads yet`, 'error');
      continue;
    }
    // Claim it before doing anything. If another copy of this extension got
    // there first, Telegram refuses this and we stand down - which is the only
    // thing that stops a Mac and a VPS both acting on one tap.
    const claim = await telegram.claimTap(ev.id, 'Working on it…');
    if (claim !== true) {
      // Telegram returns ONE error for two different things: "someone already
      // answered this" and "this is too old to answer". They are not the same
      // and the text cannot tell them apart, so standing down on both meant a
      // tap that had simply aged out - the only copy running, the server shut
      // down, a slow poll - did nothing at all, silently. That is a worse
      // failure than the one it was guarding against.
      //
      // So: pause, look again, and only stand down if the work is actually
      // done. If another copy claimed it, it will have finished in that time
      // and the lead will say so. If nothing has changed, this was an old tap
      // and it is honoured.
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
      const now = (await getLeads()).find((l) => String(l.threadId) === String(ev.threadId));
      const settled = (ev.action === 'd' || ev.action === 'f') ? now?.pmSent
                    : ev.action === 'p' ? now?.status === 'POSTED'
                    : false;
      if (settled) {
        await logOnce('twocopies',
          'Another copy of HAF Watcher took that tap. You have two running against the same bot - '
          + 'close one, or they will both act on everything you tap.', 'error');
        continue;
      }
      await log(`Telegram would not let me answer that tap (${claim.why || 'unknown'}), `
        + 'but nothing else had acted on it - carrying on');
    }
    // Logged before the work, not after. Posting opens a tab and waits on a
    // content script; if any of that stalls or the worker is killed, a line
    // written afterwards is never written at all - and "no log entry" then
    // looks identical to "the tap never arrived", which are opposite problems
    // with opposite fixes.
    const verb = TAP_VERBS[ev.action] || 'Working on it';
    // Visible on the card itself, not just in a log you are not looking at.
    // Posting or sending a PM opens a real tab and waits on a content script
    // - close to a minute, tab load and a human-length pause included. Tap
    // two different leads within that window and this loop used to reach the
    // second one only after the first fully finished, which meant its card
    // sat showing its ORIGINAL buttons, unchanged, for that whole minute -
    // indistinguishable from the tap never having arrived at all, and if the
    // second tap is still queued when you go looking, there is nothing that
    // looks like a failure to see. So every lead-posting tap is claimed and
    // marked "working" here, immediately, in the order taps were found - the
    // actual posting is still done one at a time below, never two tabs
    // racing BHW at once, but every card you tapped says so straight away.
    if (['p', 'd', 'f'].includes(ev.action)) {
      await telegram.markWorking(cfg.telegramChatId, ev.messageId, verb).catch(() => {});
      await log(`Telegram tap: ${ev.action} on "${lead.title}" - queued`);
      queued.push({ ev, lead });
      continue;
    }
    await log(`Telegram tap: ${ev.action} on "${lead.title}" - starting`);
    await telegram.markWorking(cfg.telegramChatId, ev.messageId, verb).catch(() => {});
    let line = await runTap(ev, lead, cfg);
    // Say where the day stands, on every outcome. "Posted." alone tells you the
    // tap worked and nothing about how far through you are.
    if (line) line += `\n\n${await todayLine(cfg)}`;
    await telegram.settleTap(ev, line);
    await log(`Telegram tap on "${lead.title}": ${line || 'card rewritten in place'}`);
    done++;
  }

  // The actual posting/sending, one at a time and in the order tapped - every
  // queued card already says "working" (above), so this is purely the slow
  // part happening in the background, not the first sign any of it is real.
  for (const { ev, lead } of queued) {
    await log(`Telegram tap: ${ev.action} on "${lead.title}" - starting`);
    let line = await runTap(ev, lead, cfg);
    if (line) line += `\n\n${await todayLine(cfg)}`;
    await telegram.settleTap(ev, line);
    await log(`Telegram tap on "${lead.title}": ${line || 'card rewritten in place'}`);
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

/** Minutes an unanswered edit stays open before your messages are yours again. */
const EDIT_TTL_MS = 15 * 60000;

async function takeRewrite(ev, cfg) {
  const edits = await getEdits();

  // Either you replied to the prompt, or you just typed - both count. Typing
  // is the normal way now, because dropping force_reply is what got rid of the
  // quote; a reply still works when several things are in flight.
  let key = String(ev.replyTo || '');
  let want = edits[key];
  if (!want) {
    const open = Object.entries(edits)
      .filter(([, e]) => Date.now() - (e.at || 0) < EDIT_TTL_MS)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!open.length) return false;             // nothing is waiting; you are just chatting
    [key, want] = open[0];
  }

  // A way out that does not change anything.
  if (/^\/?cancel$/i.test(ev.body.trim())) {
    await setEdit(key, null);
    await telegram.say(cfg.telegramChatId, 'Left as it was.');
    return true;
  }
  await setEdit(key, null);

  const lead = (await getLeads()).find((l) => String(l.threadId) === String(want.threadId));
  if (!lead) { await telegram.say(cfg.telegramChatId, 'That lead is no longer in the table.'); return false; }

  let body = String(ev.body || '').trim();
  if (!body) { await telegram.say(cfg.telegramChatId, 'That came through empty, so nothing was changed.'); return false; }

  // Copying the whole editor message, rather than tapping the code block,
  // brings this extension's own instructions along with the draft. Pasted back
  // they became the draft, and a buyer got "Editing the DM - Tap the text to
  // copy it" above the pitch. Taken out here, and said out loud: a silent
  // repair of something this wrong would hide it rather than surface it.
  const cleaned = stripBotText(body);
  if (cleaned.removed.length) {
    await log(`removed ${cleaned.removed.length} line(s) of the bot's own text from your rewrite`, 'error');
    if (!cleaned.text) {
      await telegram.say(cfg.telegramChatId,
        '⚠️ That was only the instructions, with none of the message - nothing was changed.\n\n'
        + 'Tap the grey block itself to copy just the draft, rather than copying the whole message.');
      return false;
    }
    await telegram.say(cfg.telegramChatId,
      `⚠️ Your text had ${cleaned.removed.length} line(s) of my own instructions in it. `
      + 'I took them out - check the draft below before sending.');
    body = cleaned.text;
  }

  // draftEdited matters: a staged tab still holds the OLD text, so postLead
  // has to type the new one in rather than just pressing Submit on the old.
  // Your version IS the approved text now - the card is rewritten to show it
  // below, so the two cannot drift apart.
  const patch = want.field === 'dm'
    ? { dm: body, dmApproved: body, dmLint: lintDraft(body, cfg.compliance) }
    : { draft: body, draftApproved: body, draftEdited: true, lint: lintDraft(body, cfg.compliance) };
  await updateLead(lead.threadId, patch);
  await log(`rewrote the ${want.field === 'dm' ? 'PM' : 'public reply'} for "${lead.title}" from Telegram`);
  // Editing is a decision about this lead, so a countdown on it stops: your
  // version should not go up seconds later because a timer was already running.
  if (lead.autoPostAt) await updateLead(lead.threadId, { autoPostAt: 0, autoBlocked: 'you edited it' });
  if (lead.autoSendAt && want.field === 'dm') await updateLead(lead.threadId, { autoSendAt: 0, autoSendBlocked: 'you edited the PM' });

  const fresh = { ...lead, ...patch };
  fresh.card = fresh.kind === 'thread' ? buildThreadCard(fresh) : buildCard(fresh);
  await updateLead(lead.threadId, { card: fresh.card });
  const kind = want.kind || (want.field === 'dm' ? 'PM' : 'reply');

  // Put the card back on the message that became the editor, so the chat ends
  // up exactly as it started. Only when there is no message to edit - an older
  // prompt, or Telegram refusing to edit something past its 48-hour window -
  // does a new card get sent.
  const back = want.messageId
    && await telegram.editIntoCard(cfg.telegramChatId, want.messageId, fresh, kind, cfg);
  if (!back) await telegram.resend(fresh, cfg, kind);
  return true;
}

/** One tap. Returns the line that goes back on the message. */
/**
 * Is this really a duplicate? Asked of BHW, now, not of a stored flag.
 *
 * The flag is written by an hourly job, so at the moment you tap it can be an
 * hour stale - and a flag written by the old loose rules could be simply
 * wrong. Since a refusal here means walking to the machine to override it, the
 * refusal has to be based on the current state of your message list rather
 * than on a cached guess.
 *
 * Costs one page fetch, about a second. A failure never blocks the send: not
 * being able to check is not evidence of a duplicate, and refusing on it would
 * make an unreachable BHW look exactly like an already-sent PM.
 */
async function duplicateCheck(lead) {
  try {
    const told = (await getConfig()).bhwUsername || '';
    const { rows, me } = await fetchConversations(1, { told });
    const hit = matchConversation(lead, rows, me);
    if (!hit) return { sent: false, maybe: false };
    if (hit.sent) {
      await updateLead(lead.threadId, {
        pmSent: true, pmSentAt: hit.at || new Date().toISOString(),
        pmFrom: FOUND_IN_LIST, pmUrl: hit.url || ''
      });
      return hit;
    }
    if (hit.maybe) return hit;
    return { sent: false, maybe: false };
  } catch (e) {
    await log(`could not check your message list before sending: ${e.message}`, 'error');
    return { sent: false, maybe: false, unchecked: e.message };
  }
}

// Names the authority, because "already sent" with no source is exactly what
// you cannot argue with. This came from your BHW message list, read seconds
// ago - not from anything the extension remembered.
const dupLine = (lead, dup) =>
  `✉️ Already sent — your BHW message list says ${dup.why}`
  + `${dup.at ? ` (${String(dup.at).slice(0, 10)})` : ''}.${dup.url ? `\n${dup.url}` : ''}`;

/**
 * A possible duplicate, put to you rather than decided for you.
 *
 * The evidence, a link to the conversation, and a Send anyway button - so the
 * call is made on your phone with the conversation one tap away, instead of
 * being refused flatly by a rule you cannot see or argue with.
 */
async function offerAnyway(lead, cfg, dup) {
  await updateLead(lead.threadId, { pmMaybe: dup.why || '', pmMaybeUrl: dup.url || '' });
  await telegram.askAnyway(cfg.telegramChatId, lead, dup);
}

async function runTap(tap, lead, cfg) {
  try {
    if (tap.action === 'c') {
      // Cancel: put the card back on the very message that became the editor.
      // Which card it was is remembered rather than guessed - the PM and the
      // reply are different messages and restoring the wrong one would lose
      // the buttons you actually wanted.
      const open = (await getEdits())[String(tap.messageId)];
      await setEdit(String(tap.messageId), null);
      const ok = await telegram.editIntoCard(cfg.telegramChatId, tap.messageId, lead,
                                             open?.kind || 'PM', cfg);
      return ok ? '' : '✖️ Left as it was.';
    }

    // The material pack: the question, the replies already there, similar
    // past answers. The card keeps its buttons - this is not an outcome.
    if (tap.action === 'o') {
      const r = await sendMaterial(lead, cfg);
      return keepCard(tap, r.lead, cfg, '');
    }
    if (lead.kind === 'thread' && ['d', 'f', 'm'].includes(tap.action)) {
      return keepCard(tap, lead, cfg, '🚫 Public reply only on this thread - no PMs outside Hire a Freelancer.');
    }
    if (lead.kind === 'thread' && tap.action === 'p' && !String(lead.draftApproved || lead.draft || '').trim()) {
      return keepCard(tap, lead, cfg, '✍️ No answer on this card yet. Tap 📋 Material, write it, then reply to the card with your answer.');
    }

    if (tap.action === 'e' || tap.action === 'm') {
      const which = tap.action === 'm' ? 'DM' : 'post';
      const current = tap.action === 'm' ? lead.dm : lead.draft;

      // Edit the card you tapped, rather than sending a new one. Three fresh
      // messages for a two-line change buried the thing being edited; now one
      // message becomes the editor and becomes the card again afterwards.
      const inPlace = tap.messageId && await telegram.editIntoEditor(
        cfg.telegramChatId, tap.messageId, which, plain(current || ''), lead.title, lead.threadId);
      if (inPlace) {
        await setEdit(String(tap.messageId), {
          threadId: String(lead.threadId),
          field: tap.action === 'm' ? 'dm' : 'draft',
          messageId: tap.messageId,
          kind: tap.action === 'm' ? 'PM' : 'reply',
          at: Date.now()
        });
        return '';                                // the edited card says it all
      }
      // The text goes in a message of its own, so one tap copies exactly it
      // and nothing else. No force_reply, so you get the full-size box with no
      // quote above it - the next thing you send is taken as the new version.
      const promptId = await telegram.askFor(cfg.telegramChatId,
        `✏️ Editing the ${which} for "${String(lead.title).slice(0, 60)}".\n`
        + `Tap the text below to copy it, paste it here, change what you like and send. `
        + `Send /cancel to leave it as it is.`,
        plain(current || ''));
      if (!promptId) return '❌ Could not open the edit box.';
      await setEdit(String(promptId), {
        threadId: String(lead.threadId),
        field: tap.action === 'm' ? 'dm' : 'draft',
        at: Date.now()
      });
      return `✏️ Editing the ${which} - send me the version you want.`;
    }

    if (tap.action === 'h') {
      if (lead.autoPostAt) {
        await updateLead(lead.threadId, { autoPostAt: 0, autoHeld: true, autoBlocked: 'you held it' });
        return '✋ Held. It will not post by itself - it is waiting for you.';
      }
      if (lead.autoSendAt) {
        await updateLead(lead.threadId, { autoSendAt: 0, autoSendHeld: true, autoSendBlocked: 'you held it' });
        return '✋ Held. It will not post by itself - it is waiting for you.';
      }
      return '✋ Nothing was counting down on this one.';
    }

    if (tap.action === 's') {
      await updateLead(lead.threadId, { status: 'SKIPPED', decidedAt: new Date().toISOString() });
      return '⏭ Skipped.';
    }

    // Both of these go through the same functions the dashboard buttons use.
    // They already count the send against your daily cap and mark the row, so
    // doing it again here would charge you twice for one PM.
    // 'f' is Send anyway: the same as 'd' but past the duplicate check, because
    // you have seen the conversation it found and decided.
    if (tap.action === 'd' || tap.action === 'f') {
      const forced = tap.action === 'f';
      if (!forced) {
        const dup = await duplicateCheck(lead);
        if (dup.sent) return dupLine(lead, dup);
        if (dup.maybe) { await offerAnyway(lead, cfg, dup); return '❓ Might be a duplicate - have a look.'; }
      }
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

/**
 * The unattended post.
 *
 * Runs on the minute alarm. Everything that decides whether a lead may go up
 * was settled when its countdown was armed; this re-checks it anyway, because
 * between then and now you may have edited the draft, the daily cap may have
 * filled, or the window may have closed - and a rule that is only enforced at
 * the moment of arming is not a rule.
 *
 * Never throws: whatever happens here, the next tick must still run.
 */
export async function runNightQueue() {
  const cfg = await getConfig();
  if (!cfg.nightMode) return { skipped: 'off' };

  const leads = await getLeads();
  const due = night.dueNow(leads);
  if (!due.length) return { due: 0 };

  // Outside the window nothing posts itself, whatever is queued. A countdown
  // armed at 06:55 must not fire at 07:30 while you are reading email.
  if (!night.isNight(cfg)) {
    for (const l of due) await updateLead(l.threadId, { autoPostAt: 0, autoBlocked: 'the night window closed first' });
    await log(`night mode: ${due.length} left for you, the window closed before they were due`);
    return { due: due.length, posted: 0, closed: true };
  }

  const cap = Number(cfg.nightMaxPosts) || 0;
  let done = 0;
  for (const lead of due) {
    if (cap > 0 && night.nightCount(await getLeads(), cfg) >= cap) {
      await updateLead(lead.threadId, { autoPostAt: 0, autoBlocked: `your overnight cap of ${cap} is used up` });
      continue;
    }
    // Re-check: you may have edited it, or it may already be decided.
    const why = night.blockedReason(lead, cfg);
    if (why) { await updateLead(lead.threadId, { autoPostAt: 0, autoBlocked: why }); continue; }

    const gate = await checkRateLimit(cfg);
    if (!gate.ok) {
      // Not a refusal, just not yet: leave it due and try on the next tick.
      await log(`night mode: holding "${lead.title}" - ${gate.reason}`);
      continue;
    }

    const r = await postLead(lead, cfg, { edited: !!lead.draftEdited });
    await updateLead(lead.threadId, r?.ok
      ? { autoPostAt: 0, autoPostedAt: new Date().toISOString(), autoBlocked: '' }
      : { autoPostAt: 0, autoBlocked: `posting failed: ${r?.error || 'unknown'}` });
    await log(`night mode: ${r?.ok ? 'posted' : 'failed'} "${lead.title}"${r?.ok ? '' : ` - ${r?.error}`}`);
    if (r?.ok) {
      done++;
      await telegram.say(cfg.telegramChatId,
        `🌙 Posted while you were asleep: ${lead.title}${r.postUrl ? `\n${r.postUrl}` : ''}`).catch(() => {});
    }
  }
  return { due: due.length, posted: done };
}

/**
 * The unattended post, auto mode's version. Runs on the same minute alarm as
 * runNightQueue and follows the same shape: re-check everything at posting
 * time, never throw, only ever post the public reply.
 */
/**
 * Auto mode, in numbers: what it sent by itself today, what is counting
 * down, what it left for you and why. "auto" on its own, from the phone.
 */
export async function autoReport(cfg) {
  const leads = (await getLeads()).filter((l) => l.kind !== 'thread');
  const day = new Date().toLocaleDateString('en-CA');
  const on = (t) => !!t && new Date(t).toLocaleDateString('en-CA') === day;
  const sent = leads.filter((l) => on(l.autoSentAt));
  const counting = auto.pending(leads);
  const held = leads.filter((l) => l.autoSendHeld && !l.pmSent && on(l.foundAt));
  const skipped = leads.filter((l) => l.autoSendBlocked && !l.pmSent && on(l.foundAt));
  const since = cfg.autoModeSince ? new Date(cfg.autoModeSince) : null;
  const sinceOn = since ? leads.filter((l) => l.autoSentAt && new Date(l.autoSentAt) >= since).length : 0;
  const r = await getRateState();
  const ai = await aiStatus().catch(() => null);
  const claudeOk = !!(ai && ai.configured && ai.enabled !== false && !ai.overBudget);
  const mins = (at) => Math.max(1, Math.round((at - Date.now()) / 60000));
  // The reasons, most common first, so "why is nothing sending" answers itself.
  const why = {};
  for (const l of skipped) { const k = String(l.autoSendBlocked).replace(/\s*\(.*$/, '').replace(/:.*$/, ''); why[k] = (why[k] || 0) + 1; }
  const reasons = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `   • ${n} × ${escHtml(k)}`);
  const lines = [
    `⚡ <b>Auto mode is ${cfg.autoMode ? 'ON' : 'OFF'}</b>` + (cfg.autoMode && since ? ` — since ${since.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''),
    `✉️ PMs sent by itself: <b>${sent.length} today</b>` + (cfg.autoMode && since ? ` · ${sinceOn} since it was switched on` : ''),
    `⏳ Counting down: ${counting.length}` + (counting.length ? ` (next in ~${mins(Math.min(...counting.map((l) => l.autoSendAt)))} min)` : ''),
    `✋ Held by you today: ${held.length}`,
    `⏭ Left for you today: ${skipped.length}`,
    ...reasons,
    `📊 PM cap: ${Number(cfg.maxDmsPerDay) > 0 ? `${r.dmCount || 0}/${cfg.maxDmsPerDay}` : `${r.dmCount || 0} (no cap)`} · public replies are never automatic`,
    `🧠 Claude screen: ${claudeOk ? 'available' : 'NOT available - nothing will send until the key works'}`
  ];
  if (sent.length) {
    lines.push('', '<b>Sent today</b>');
    for (const l of sent.slice(0, 8)) lines.push(`• ${escHtml(l.author)} — <a href="${escHtml(l.url)}">${escHtml(String(l.title).slice(0, 60))}</a>`);
    if (sent.length > 8) lines.push(`…and ${sent.length - 8} more`);
  }
  lines.push('', 'Send "auto on" or "auto off" to change it.');
  return lines.join('\n');
}

export async function runAutoQueue() {
  const cfg = await getConfig();
  if (!cfg.autoMode) return { skipped: 'off' };

  const leads = await getLeads();
  const due = auto.dueNow(leads);
  if (!due.length) return { due: 0 };

  let done = 0;
  for (const lead of due) {
    // Re-check at the moment of sending: you may have edited it, Claude's
    // verdict may have been replaced, or it may have been sent some other way.
    const why = auto.blockedReason(lead, cfg);
    if (why) {
      await updateLead(lead.threadId, { autoSendAt: 0, autoSendBlocked: why });
      await log(`auto mode: not sending the PM for "${lead.title}" - ${why}`);
      continue;
    }

    const gate = await checkDmLimit(cfg);
    if (!gate.ok) {
      await log(`auto mode: holding the PM for "${lead.title}" - ${gate.reason}`);
      continue;      // not a refusal, just not yet - try again on the next tick
    }

    // Your message list, read now: a PM you already sent this buyer is never sent twice.
    const dup = await duplicateCheck(lead);
    if (dup.sent || dup.maybe) {
      const w = dup.sent ? 'your message list already has a PM to them' : `might be a duplicate: ${dup.why || 'a conversation exists'}`;
      await updateLead(lead.threadId, { autoSendAt: 0, autoSendBlocked: w });
      await log(`auto mode: not sending the PM for "${lead.title}" - ${w}`);
      continue;
    }

    const r = await sendDm(lead, cfg, { mode: 'send' });
    const sent = !!(r?.ok && r?.sent);
    await updateLead(lead.threadId, sent
      ? { autoSendAt: 0, autoSentAt: new Date().toISOString(), autoSendBlocked: '' }
      : { autoSendAt: 0, autoSendBlocked: `sending failed: ${r?.error || 'unknown'}` });
    await log(`auto mode: ${sent ? 'sent the PM for' : 'failed to send the PM for'} "${lead.title}"${sent ? '' : ` - ${r?.error}`}`);
    if (sent) {
      done++;
      await telegram.say(cfg.telegramChatId,
        `⚡ Auto-sent the PM to ${lead.author}: ${lead.title}\n${lead.url}\n\n${await todayLine(cfg)}`).catch(() => {});
    } else {
      await telegram.say(cfg.telegramChatId,
        `⚠️ Auto mode could not send the PM to ${lead.author} (${r?.error || 'unknown'}). It is waiting for you: ${lead.title}`).catch(() => {});
    }
  }
  return { due: due.length, sent: done };
}

/**
 * What happened overnight, once, when the window closes. Sent even when
 * nothing went out: "nothing posted" is information at 7am, and silence from a
 * thing that posts on your behalf is not.
 */
export async function nightSummary() {
  const cfg = await getConfig();
  if (!cfg.nightMode || !cfg.nightSummary) return { skipped: 'off' };
  if (night.isNight(cfg)) return { skipped: 'still night' };

  const key = new Date().toISOString().slice(0, 10);
  const { nightSummaryOn } = await chrome.storage.local.get('nightSummaryOn');
  if (nightSummaryOn === key) return { skipped: 'already sent today' };
  await chrome.storage.local.set({ nightSummaryOn: key });

  const leads = await getLeads();
  const posted = leads.filter((l) => l.autoPostedAt && Date.now() - new Date(l.autoPostedAt).getTime() < 16 * 3600000);
  const held = leads.filter((l) => l.autoBlocked && !['POSTED', 'SKIPPED'].includes(l.status));
  const waiting = leads.filter((l) => ['SENT', 'NEW'].includes(l.status) && !l.autoBlocked && !l.autoPostedAt);
  if (!posted.length && !held.length && !waiting.length) return { skipped: 'nothing to report' };

  const lines = [`🌅 Overnight: ${posted.length} posted, ${held.length} held, ${waiting.length} waiting for you.`];
  // say() sends plain text, so no escaping is needed and none is invented.
  for (const l of posted.slice(0, 5)) lines.push(`🚀 ${l.title}`);
  for (const l of held.slice(0, 5)) lines.push(`✋ ${l.title} — ${l.autoBlocked}`);
  await telegram.say(cfg.telegramChatId, lines.join('\n').slice(0, 3500)).catch(() => {});
  return { posted: posted.length, held: held.length, waiting: waiting.length };
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
  // Same rule as the PM: what the card showed is what goes up.
  if (lead.draftApproved && lead.draftApproved !== lead.draft) {
    lead = { ...lead, draft: lead.draftApproved };
  }

  // The same hard stop as the PM. A public reply carrying the editor's own
  // instructions would be worse, not better - it is on the thread for everyone
  // to read, and cannot be quietly deleted.
  const bot = botTextIn(lead.draft);
  if (bot) {
    const why = `refusing to post: the reply still contains my own text ("${bot}"). `
      + 'Tap the grey block to copy just the draft, or press Rewrite drafts on the dashboard.';
    await updateLead(lead.threadId, { error: why });
    await log(`reply to "${lead.title}" BLOCKED - ${why}`, 'error');
    return { ok: false, blocked: true, error: why };
  }

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
    const marked = await updateLead(lead.threadId, { status: 'POSTED', postUrl: result.postUrl, draft: lead.draft, staged: false, error: '' });
    if (!marked) await log(`posted "${lead.title}" but could not find its row to mark (id ${lead.threadId})`, 'error');
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
/**
 * How long a PM may be considered in flight before the lock is ignored.
 *
 * Longer than the worst realistic send (30s for the tab, a pause, 45s for the
 * content script) so a slow forum never looks like a stuck lock, and short
 * enough that a worker killed mid-send does not wedge the lead for ever.
 */
const PM_LOCK_MS = 3 * 60000;

export async function sendDm(lead, cfg, { mode = 'send' } = {}) {
  // The text you approved on the card, verbatim - not a fresh render of it.
  // Rendering again is how a card showing three Claude-written lines about
  // Facebook group posting became a generic two-line PM on the forum: the
  // lead had changed in between, and the send drew from the lead rather than
  // from what was shown. A render here is the last resort, and says so.
  let body = lead.dmApproved || lead.dm;
  if (!body) {
    body = renderDm(lead, cfg);
    await log(`no saved PM text for "${lead.title}" - writing a fresh one, which may `
      + 'not match what your phone showed', 'error');
  }
  const title = lead.dmTitle || renderDmTitle(lead, cfg);

  // The last gate, and the one that cannot be tapped through. Not part of the
  // configurable compliance rules on purpose: those are yours to tune and can
  // be switched off, and this must not be. It is not an opinion about wording,
  // it is a refusal to send this extension's own interface to a customer -
  // which happened, to a real buyer, because the editor's instructions and the
  // draft shared one Telegram message and a whole-message copy took both.
  // A second lock, inside this copy. The Telegram claim stops two installs
  // racing; this stops one install racing itself - a tap while a send is still
  // in flight, an alarm firing during a manual send, a retry on a slow forum.
  // Sending takes up to a minute, which is a wide window to land a second tap in.
  const fresh = (await getLeads()).find((l) => String(l.threadId) === String(lead.threadId)) || lead;
  if (fresh.pmSending && Date.now() - fresh.pmSending < PM_LOCK_MS) {
    const secs = Math.ceil((PM_LOCK_MS - (Date.now() - fresh.pmSending)) / 1000);
    const why = `already sending this PM - started ${Math.round((Date.now() - fresh.pmSending) / 1000)}s ago`;
    await log(`DM to ${lead.author} held: ${why}`, 'error');
    return { ok: false, blocked: true, error: `${why}. Give it ${secs}s.` };
  }
  if (fresh.pmSent) {
    // Settled between the tap and here - another path got there first.
    return { ok: false, blocked: true, error: 'already sent - not sending it twice' };
  }
  await updateLead(lead.threadId, { pmSending: Date.now() });

  const bot = botTextIn(body) || botTextIn(title);
  if (bot) {
    const why = `refusing to send: the draft still contains my own text ("${bot}"). `
      + 'Tap the grey block to copy just the draft, or press Rewrite drafts on the dashboard.';
    await updateLead(lead.threadId, { pmError: why, pmSending: 0 });
    await log(`DM to ${lead.author} BLOCKED - ${why}`, 'error');
    return { ok: false, blocked: true, error: why };
  }
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
    let result = await pending;

    // https://www.blackhatworld.com/direct-messages/ is the authority, and it is
    // asked on EVERY send, not only the ones the page failed to confirm. The
    // page can only report what it saw in a tab; the message list is the forum's
    // own record of what exists. Reading it here means "sent" on the dashboard
    // means the same thing as "sent" on BHW - which is the whole point, since
    // the strike-through on the row is what stops a second PM going out.
    const proof = await duplicateCheck(lead);
    if (proof.sent) {
      // The list has it. That settles it whatever the tab thought, and the
      // conversation URL comes along so the row can link to it.
      if (!result.sent) await log(`DM to ${lead.author} did go - the page never said so, your message list did`);
      result = { ...result, ok: true, sent: true, dmUrl: proof.url || result.dmUrl || result.movedTo || '' };
      result.provenBy = FOUND_IN_LIST;
    } else if (result.sent) {
      // The tab watched it send but the list has not caught up - a new
      // conversation can take a moment to appear. The tab is good enough
      // evidence on its own, and the hourly check will line the two up.
      result.provenBy = 'the page itself';
    } else if (result.unconfirmed) {
      await log(`DM to ${lead.author}: the page never confirmed it and it is not in your `
        + 'message list either - the tab is left open so you can finish it by hand', 'error');
    }

    if (result.ok && result.sent) {
      await recordDm();
      await updateLead(lead.threadId, {
        pmSent: true, pmSentAt: new Date().toISOString(), dm: body, pmError: '',
        // Records that WE sent it, never who confirmed it. The clearing pass
        // below only takes back flags it set itself (FOUND_IN_LIST), so
        // writing the confirming authority here would make a PM we really
        // sent eligible to be un-marked later if the subject ever drifted.
        pmFrom: 'sent from here', pmUrl: result.dmUrl || '',
        pmMaybe: '', pmMaybeUrl: '', pmSending: 0
      });
      await log(`DM sent → ${lead.author} (confirmed by ${result.provenBy || 'the page'})`);
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 3000);
    } else {
      // Every remaining case lands here, including {ok:true, sent:false}, which
      // used to match neither branch: no flag, no error, no log line, and a row
      // that looked untouched for a PM that may well have been sent.
      const why = result.error || 'it did not go through and did not say why';
      await updateLead(lead.threadId, { pmError: why, pmSending: 0 });
      if (result.ok !== false) await log(`DM not confirmed (${lead.author}): ${why}`, 'error');
      else await log(`DM failed (${lead.author}): ${why}`, 'error');
      // Leave the tab open on failure so it can be finished by hand.
      chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    }
    return result;
  } catch (e) {
    // The lock must come off on the way out of every path, or a send that
    // threw leaves the lead unsendable for three minutes with no explanation.
    await updateLead(lead.threadId, { pmSending: 0, pmError: e.message }).catch(() => {});
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
      case 'poll-now':      sendResponse(await runCheck().catch((e) => ({ error: e.message }))); break;
      case 'sources-now':   sendResponse(await pollSources({ all: !!msg.all }).catch((e) => ({ error: e.message }))); break;
      case 'clear-wall':    await clearWall(); sendResponse({ ok: true }); break;
      case 'sources-status': {                       // the dashboard's Other sources view
        const cfg = await getConfig();
        sendResponse({ sources: sourcesOf(cfg), words: watchWordsOf(cfg).map((w) => ({ word: w.word, enabled: w.enabled, bumpAlerts: w.bumpAlerts })),
                       index: await indexStats(), bank: await bankStats() });
        break;
      }
      case 'save-answer': {                          // 💾 from the dashboard: your answer, kept on the lead and its card
        const cfg = await getConfig();
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        if (!lead) { sendResponse({ error: 'That lead is not in the table.' }); break; }
        const body = String(msg.draft || '').trim();
        const patch = { draft: body, draftApproved: body, draftEdited: true, lint: lintDraft(body, cfg.compliance) };
        const fresh = { ...lead, ...patch };
        fresh.card = fresh.kind === 'thread' ? buildThreadCard(fresh) : buildCard(fresh);
        await updateLead(lead.threadId, { ...patch, card: fresh.card });
        const mid = lead.tgCards?.['public reply'];
        const card = mid && cfg.telegramChatId ? await telegram.editIntoCard(cfg.telegramChatId, mid, fresh, 'reply', cfg).catch(() => false) : false;
        sendResponse({ ok: true, card });
        break;
      }
      case 'tg-material': {                          // 📋 from the dashboard
        const cfg = await getConfig();
        const lead = (await getLeads()).find((l) => String(l.threadId) === String(msg.threadId));
        if (!lead) { sendResponse({ error: 'That lead is not in the table.' }); break; }
        if (!cfg.telegramChatId) { sendResponse({ error: 'No Telegram chat id saved.' }); break; }
        sendResponse(await sendMaterial(lead, cfg).then((r) => ({ ok: true, sent: r.sent, replies: r.replies, matches: r.matches })).catch((e) => ({ error: e.message })));
        break;
      }
      case 'load-forum': {                           // the last N days of a watched forum into the queue
        sendResponse(await loadForum(await getConfig(), msg.label || '', msg.days || 2).catch((e) => ({ error: e.message })));
        break;
      }
      case 'seed-bank': {                            // fill the answer bank from a watched forum
        const cfg = await getConfig();
        await seedForum(cfg, msg.label || '').catch((e) => log(`seed: ${e.message}`, 'error'));
        sendResponse({ ok: true, ...(await bankStats()) });
        break;
      }
      case 'approvals-now': sendResponse(await pollApprovals().then(() => ({ ok: true })).catch((e) => ({ error: e.message }))); break;
      case 'reschedule':    await scheduleAlarms(await getConfig()); sendResponse({ ok: true }); break;
      case 'staged':        sendResponse(await getStaged()); break;
      // Deliberately pollFeed, not runCheck: re-finding two days of threads is
      // for the table, not for your phone. Anything genuinely new among them
      // still reaches Telegram on the next ordinary check.
      case 'backfill':      await clearSeen(); sendResponse(await pollFeed().catch((e) => ({ error: e.message }))); break;
      case 'post-direct': {                          // 🚀 from the dashboard, no Telegram needed
        const cfg = await getConfig();
        const gate = await checkRateLimit(cfg);
        if (!gate.ok) { sendResponse({ ok: false, error: gate.reason }); break; }
        // An edit made in the dashboard is the approved text now - otherwise
        // postLead would put the older Telegram-approved wording back.
        const toPost = msg.edited ? { ...msg.lead, draftApproved: msg.lead.draft } : msg.lead;
        sendResponse(await postLead(toPost, cfg, { edited: !!msg.edited }));
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
      case 'batch-track-services': {                // Settings / service-threads page: paste links, read titles live
        const cfg = await getConfig();
        sendResponse(await batchTrackServiceThreads(cfg, msg.text || '').catch((e) => ({ error: e.message })));
        break;
      }
      case 'bump-idea': {                            // service-threads page: "Get idea", no Telegram involved
        sendResponse(bumpIdeaFor(await getConfig(), msg.label));
        break;
      }
      case 'mark-bumped-thread': {                   // service-threads page: "Mark bumped"
        sendResponse(await markBumped(await getConfig(), msg.label));
        break;
      }
      case 'untrack-service-thread': {                // service-threads page: "Untrack"
        sendResponse(await untrackServiceThread(await getConfig(), msg.label));
        break;
      }
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
        const { specifics: ai } = await specificsFor([m], cfg).catch(() => ({ specifics: {} }));
        const lead = enrich(m, cfg, 'SENT', ai[m.threadId]);

        const done = [];
        sendResponse(await telegram
          .sendLead(lead, { ...cfg, telegramEnabled: true }, { onPart: (n, e) => !e && done.push(n) })
          .then(() => ({ ok: true, sent: done, usedClaude: !!ai[m.threadId] }))
          .catch((e) => ({ error: e.message, sent: done, usedClaude: !!ai[m.threadId] })));
        break;
      }
      case 'tg-selftest': {                          // the whole chain, end to end
        const cfg = await getConfig();
        const out = await telegram.diagnose(cfg).catch((e) => ({ ok: false, checks: [['✗', e.message]] }));

        // What version is actually running, and whether a pull is waiting to
        // be picked up - "is it up to date" is half the question.
        const running = chrome.runtime.getManifest().version;
        let onDisk = running;
        try { onDisk = (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json()).version; }
        catch { /* reported as unknown below */ }
        out.checks.unshift(onDisk === running
          ? ['✓', `Running v${running}, which is what is in the folder.`]
          : ['!', `Running v${running} but v${onDisk} is in the folder - it reloads within a minute, or press More → Install update.`]);

        // Is the tap poller actually armed?
        const alarm = await chrome.alarms.get('telegram-taps').catch(() => null);
        out.checks.push(cfg.telegramApprovals && alarm
          ? ['✓', `Checking for your taps every ${Math.max(30, Number(cfg.telegramPollSeconds) || 30)}s.`]
          : cfg.telegramApprovals
            ? ['✗', 'Approvals are on but the checker is not running. Press Save on this page to arm it.']
            : ['!', 'Approval buttons are off, so nothing will have buttons to tap.']);

        // Did the checker actually run recently? An armed alarm only means it
        // is scheduled; on a machine nobody touches, Chrome can be closed, the
        // session logged off or the worker killed mid-job, and the alarm looks
        // exactly the same. This is the fact that tells the difference.
        const hb = await tapsHeartbeat();
        const ageS = hb ? Math.round((Date.now() - hb.at) / 1000) : 0;
        const expect = Math.max(30, Number(cfg.telegramPollSeconds) || 30);
        out.checks.push(!hb
          ? ['✗', 'The tap checker has never run on this install. Chrome has to be open and this '
              + 'extension switched on for a tap to reach it.']
          : ageS <= expect * 3
            ? ['✓', `The tap checker last ran ${ageS}s ago (${hb.note || 'ok'}).`]
            : ['✗', `The tap checker last ran ${ageS >= 120 ? Math.round(ageS / 60) + ' minutes' : ageS + ' seconds'} ago, `
                + `but it should run every ${expect}s. Chrome was probably closed, the machine asleep, or the `
                + 'Windows session logged off. Taps only work while Chrome is actually running.']);

        if (out.ok) {
          try {
            await telegram.selfTest(cfg);
            out.checks.push(['✓', 'Test message sent. Tap the button on your phone to finish the test.']);
            out.awaitingTap = true;
          } catch (e) { out.ok = false; out.checks.push(['✗', `Could not send the test message: ${e.message}`]); }
        }
        const { tgSelfTestAt } = await chrome.storage.local.get('tgSelfTestAt');
        out.lastTapAt = tgSelfTestAt || 0;
        sendResponse(out);
        break;
      }
      case 'tg-selftest-seen': {                     // has the test button been tapped yet
        const { tgSelfTestAt } = await chrome.storage.local.get('tgSelfTestAt');
        sendResponse({ at: tgSelfTestAt || 0 });
        break;
      }
      case 'tg-unhook': {                            // hand the bot back from the webhook
        sendResponse(await telegram.removeWebhook()
          .then(async (r) => { if (r.gone) await log('removed the webhook from the Telegram bot'); return r; })
          .catch((e) => ({ error: e.message })));
        break;
      }
      case 'tg-findchat': {                          // read your own chat id off the bot
        sendResponse(await telegram.findChatId().catch((e) => ({ error: e.message })));
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
          .then(async (r) => {
            // Remember the card, so replying to it on the phone finds this lead.
            if (r?.ids && Object.keys(r.ids).length) await stampCards(lead.threadId, r.ids, { tgSentAt: lead.tgSentAt || new Date().toISOString() });
            return { ok: true, sent: done };
          })
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
      case 'seed-status':   sendResponse(await seedStatus().catch((e) => ({ error: e.message }))); break;
      case 'sync-status':
        sendResponse(await syncStatus()
          .then((r) => ({ ...r, extensionId: chrome.runtime.id }))
          .catch((e) => ({ error: e.message })));
        break;
      case 'seed-apply':
        sendResponse(await applySeed({ force: msg.force !== false })
          .then((r) => ({ ...r, file: SEED_FILE }))
          .catch((e) => ({ error: e.message })));
        break;
      case 'sync-pms':      sendResponse(await syncSentPms({ pages: msg.pages || 1 }).catch((e) => ({ error: e.message }))); break;
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
      case 'backup-status': {
        const synced = await readSynced();
        sendResponse({ at: synced?.at || 0, keys: synced ? Object.keys(synced.cfg).length : 0 });
        break;
      }
      case 'backup-now':    sendResponse(await pushConfig(await getConfig())); break;
      case 'backup-export': sendResponse(await exportAll({ secrets: !!msg.secrets })); break;
      case 'backup-import': {
        const r = await importAll(msg.data);
        if (r.ok) { await scheduleAlarms(await getConfig()); await log(`imported ${r.settings} setting(s) from a backup file`); }
        sendResponse(r);
        break;
      }
      default:
        // Almost always a version skew rather than a bug: the pages reload the
        // moment you open them, the service worker only reloads on its own
        // timer, so a button added in this update can reach a worker from the
        // last one. "unknown command" gave no way to work that out.
        sendResponse({ error: `this copy of the extension does not know "${msg.cmd}". `
          + `The background worker is still running v${chrome.runtime.getManifest().version} while this page `
          + `is newer. Press More → Install update on the dashboard, or give it a minute to reload itself, `
          + `then try again.` });
    }
  })();
  return true;
});
