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
import { fetchListing, forumUrlFromFeed, withListing } from './listing.js';
import { matchLead } from './matcher.js';
import { renderReply, renderDm } from './templates.js';
import { lintDraft } from './compliance.js';
import { buildCard } from './telegram-card.js';
import { pushLeads, fetchApproved, reportResult, fetchRecent } from './sync.js';
import {
  getSeen, markSeen, clearSeen, isFirstRun, recordLeads, getLeads, updateLead, mergeLeads, updateReplyCounts,
  checkRateLimit, recordPost, log,
  getStaged, setStaged, removeStagedByTab
} from './store.js';

const FEED_ALARM = 'poll-feed';
const APPROVAL_ALARM = 'poll-approvals';
const UPDATE_ALARM = 'check-update';

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  const migrated = await migrateConfig();
  const cfg = await getConfig();
  await setConfig(cfg);
  await scheduleAlarms(cfg);
  await log(details.reason === 'install' ? 'installed' : `reloaded (v${chrome.runtime.getManifest().version}${migrated ? ', settings upgraded' : ''})`);
});
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
  } catch (e) {
    await log(`${alarm.name}: ${e.message}`, 'error');
  }
});

// ------------------------------------------------------------------- feed

/** BHW's new-conversation page with the recipient filled in. You paste and send. */
export function dmUrl(author) {
  return `https://www.blackhatworld.com/conversations/add?to=${encodeURIComponent(author || '')}`;
}

/** Everything derived from a matched thread: public reply, PM draft, lint, Telegram card. */
export function enrich(m, cfg, status) {
  const draft = renderReply(m, cfg);
  const dm = renderDm(m, cfg);
  const lead = {
    ...m, draft, dm, dmUrl: dmUrl(m.author),
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

  const leads = [];
  for (const raw of fresh) {
    const item = withListing(raw, listing[raw.threadId]);
    // Every new thread goes through. matchLead only decides category/score;
    // an unmatched thread still gets sent with score 0 and a generic draft.
    const m = matchLead(item, cfg) || { ...item, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 };
    if (m.score < cfg.notifyScore) continue;
    leads.push(enrich(m, cfg, 'SENT'));
  }
  await markSeen(fresh.map((i) => i.threadId));

  if (!leads.length) return { new: fresh.length, matched: 0 };

  await recordLeads(leads);
  try {
    const r = await pushLeads(cfg, leads);
    await log(`${fresh.length} new → ${r.sent ?? leads.length} sent, ${r.expired ?? 0} expired, ${r.held ?? 0} held`);
  } catch (e) {
    await log(`push failed, leads kept locally: ${e.message}`, 'error');
  }

  const hot = leads.filter((l) => l.score >= cfg.stageScore).sort((a, b) => b.score - a.score);
  if (hot.length) {
    notify(hot.length === 1 ? `HAF lead · ${hot[0].score} pts` : `${hot.length} hot HAF leads`, hot[0].title);
    await stageLeads(hot, cfg);
  }
  return { new: fresh.length, matched: leads.length, staged: hot.length };
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/selectors.js', 'src/content-post.js'] });
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

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic', iconUrl: chrome.runtime.getURL('src/icons/icon128.png'),
    title, message: String(message || '').slice(0, 180)
  });
}

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
        const staged = (await getStaged())[msg.threadId];
        if (staged) { chrome.tabs.remove(staged.tabId).catch(() => {}); await setStaged(msg.threadId, null); }
        await updateLead(msg.threadId, { status: msg.status, staged: false, error: '' });
        if (cfg.webhookUrl) await reportResult(cfg, msg.threadId, msg.status, msg.detail || '').catch((e) => log(`sheet update failed: ${e.message}`, 'error'));
        sendResponse({ ok: true });
        break;
      }
      case 'regen': {                                // rebuild PM + card for leads saved before the PM existed
        const cfg = await getConfig();
        const leads = await getLeads();
        let n = 0;
        for (const l of leads) {
          const dm = renderDm(l, cfg);
          if (dm === l.dm) continue;
          const patch = { dm, dmUrl: dmUrl(l.author), dmLint: lintDraft(dm, cfg.compliance) };
          patch.card = buildCard({ ...l, ...patch });
          await updateLead(l.threadId, patch);
          n++;
        }
        await log(`rebuilt PM drafts for ${n} lead(s)`);
        sendResponse({ ok: true, updated: n });
        break;
      }
      case 'mark-pm': {                              // ✅ "I sent the PM" from the dashboard
        await updateLead(msg.threadId, { pmSent: true, pmSentAt: new Date().toISOString() });
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
      case 'check-update':  sendResponse(await checkForUpdate()); break;
      default:              sendResponse({ error: 'unknown command' });
    }
  })();
  return true;
});
