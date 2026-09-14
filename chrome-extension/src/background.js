// MV3 service worker: the watcher, the matcher, and the hand that posts.
//
// Two alarms drive everything (setTimeout does not survive worker sleep):
//   poll-feed      — every cfg.pollMinutes, looks for new HAF threads
//   poll-approvals — every cfg.approvalPollMinutes, asks Apps Script what you
//                    approved from your phone

import { getConfig, setConfig, DEFAULT_CONFIG } from './config.js';
import { fetchFeed } from './feed.js';
import { matchLead } from './matcher.js';
import { renderReply } from './templates.js';
import { pushLeads, fetchApproved, reportResult } from './sync.js';
import {
  getSeen, markSeen, isFirstRun, recordLeads, updateLead,
  checkRateLimit, recordPost, log
} from './store.js';

const FEED_ALARM = 'poll-feed';
const APPROVAL_ALARM = 'poll-approvals';

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  await setConfig(cfg);          // materialise defaults on first install
  await scheduleAlarms(cfg);
  await log('installed');
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarms(await getConfig());
});

export async function scheduleAlarms(cfg) {
  await chrome.alarms.clear(FEED_ALARM);
  await chrome.alarms.clear(APPROVAL_ALARM);
  if (!cfg.enabled) return;
  chrome.alarms.create(FEED_ALARM, {
    periodInMinutes: Math.max(1, cfg.pollMinutes),
    delayInMinutes: 0.1
  });
  chrome.alarms.create(APPROVAL_ALARM, {
    periodInMinutes: Math.max(1, cfg.approvalPollMinutes)
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === FEED_ALARM) await pollFeed();
    if (alarm.name === APPROVAL_ALARM) await pollApprovals();
  } catch (e) {
    await log(`${alarm.name}: ${e.message}`, 'error');
  }
});

// ------------------------------------------------------------------- feed

export async function pollFeed() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };

  const items = await fetchFeed(cfg.feedUrl);
  const seen = await getSeen();
  const fresh = items.filter((i) => !seen[i.threadId]);

  // First run: swallow the current page so you don't get 20 emails at once.
  if (await isFirstRun()) {
    await markSeen(items.map((i) => i.threadId));
    await log(`seeded ${items.length} existing threads (no emails sent)`);
    return { seeded: items.length };
  }

  const leads = [];
  for (const item of fresh) {
    const m = matchLead(item, cfg);
    if (!m || m.score < cfg.notifyScore) continue;
    leads.push({ ...m, draft: renderReply(m, cfg), status: 'SENT', foundAt: new Date().toISOString() });
  }

  await markSeen(fresh.map((i) => i.threadId));   // seen = processed, match or not

  if (leads.length) {
    await recordLeads(leads);
    try {
      await pushLeads(cfg, leads);
      await log(`emailed ${leads.length} lead(s) of ${fresh.length} new thread(s)`);
    } catch (e) {
      await log(`push failed, leads kept locally: ${e.message}`, 'error');
    }
    notify(
      leads.length === 1 ? `New HAF lead (${leads[0].score} pts)` : `${leads.length} new HAF leads`,
      leads[0].title
    );
  } else if (fresh.length) {
    await log(`${fresh.length} new thread(s), none matched`);
  }
  return { new: fresh.length, matched: leads.length };
}

// -------------------------------------------------------------- approvals

export async function pollApprovals() {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.autoPost || !cfg.webhookUrl) return;

  const approved = await fetchApproved(cfg);
  if (!approved.length) return;

  // One per tick — spacing is enforced by the rate limiter anyway.
  const lead = approved[0];
  const gate = await checkRateLimit(cfg);
  if (!gate.ok) {
    await log(`holding "${lead.title}" — ${gate.reason}`);
    return;
  }

  await log(`posting to "${lead.title}"`);
  const result = await postReply(lead, cfg);

  if (result.ok) {
    await recordPost();
    await updateLead(lead.threadId, { status: 'POSTED', postUrl: result.postUrl });
    await reportResult(cfg, lead.threadId, 'POSTED', result.postUrl || '');
    notify('Posted to HAF', lead.title);
  } else {
    await updateLead(lead.threadId, { status: 'FAILED', error: result.error });
    await reportResult(cfg, lead.threadId, 'FAILED', result.error || 'unknown');
    await log(`post failed: ${result.error}`, 'error');
    notify('HAF post FAILED', result.error || lead.title);
  }
}

// --------------------------------------------------------------- posting

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('tab load timeout')); }, timeoutMs);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') { cleanup(); resolve(); }
    };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function waitForResult(threadId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: 'content script timed out' }); }, timeoutMs);
    const onMsg = (msg) => {
      if (msg && msg.type === 'haf-post-result' && String(msg.threadId) === String(threadId)) {
        cleanup();
        resolve(msg.result);
      }
    };
    const cleanup = () => { clearTimeout(timer); chrome.runtime.onMessage.removeListener(onMsg); };
    chrome.runtime.onMessage.addListener(onMsg);
  });
}

export async function postReply(lead, cfg, { dryRun = false } = {}) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: lead.url, active: false });
    await waitForTabLoad(tab.id);
    // Human-ish pause between page load and typing.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (draft, dry, threadId) => {
        globalThis.__HAF_DRAFT__ = draft;
        globalThis.__HAF_DRY_RUN__ = dry;
        globalThis.__HAF_THREAD_ID__ = threadId;
      },
      args: [lead.draft, dryRun, String(lead.threadId)]
    });

    const pending = waitForResult(lead.threadId);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/selectors.js', 'src/content-post.js']
    });
    return await pending;
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (tab?.id && !dryRun) {
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 4000);
    }
  }
}

// ---------------------------------------------------------------- helpers

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon128.png'),
    title,
    message: String(message || '').slice(0, 180)
  });
}

// Messages from the popup / options page.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.cmd) return;
  (async () => {
    switch (msg.cmd) {
      case 'poll-now':      sendResponse(await pollFeed().catch((e) => ({ error: e.message }))); break;
      case 'approvals-now': sendResponse(await pollApprovals().then(() => ({ ok: true })).catch((e) => ({ error: e.message }))); break;
      case 'reschedule':    await scheduleAlarms(await getConfig()); sendResponse({ ok: true }); break;
      case 'test-post':     sendResponse(await postReply(msg.lead, await getConfig(), { dryRun: true })); break;
      case 'defaults':      sendResponse(DEFAULT_CONFIG); break;
      default:              sendResponse({ error: 'unknown command' });
    }
  })();
  return true; // keep the message channel open for the async reply
});
