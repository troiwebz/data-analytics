// Client for the Google Apps Script control plane.

async function call(cfg, action, payload = {}) {
  if (!cfg.webhookUrl) throw new Error('webhookUrl not configured');
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    // Apps Script rejects preflighted requests; text/plain keeps it simple.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, secret: cfg.sharedSecret, ...payload }),
    redirect: 'follow'
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Apps Script returned non-JSON (${res.status}): ${text.slice(0, 200)}`); }
  if (!data.ok) {
    if (/unknown action/i.test(data.error || '')) {
      throw new Error('Your Apps Script is an older version. Paste the newest Code.gs into it and redeploy (Deploy > Manage deployments > pencil > New version), then try again.');
    }
    throw new Error(data.error || 'Apps Script reported failure');
  }
  return data;
}

/** Send new leads. Apps Script dedupes and sends them to Telegram.
 *  backfill=true records them in the Sheet only — no Telegram. */
export const pushLeads = (cfg, leads, { backfill = false } = {}) =>
  call(cfg, 'ingest', { leads, backfill });

/** Leads you approved from your phone, ready to post. */
export const fetchApproved = (cfg) => call(cfg, 'pending').then((d) => d.leads || []);

/** Report the outcome of a post attempt. */
export const reportResult = (cfg, threadId, status, detail) =>
  call(cfg, 'result', { threadId, status, detail });

/** Last N rows of the Sheet (needs the Apps Script 'recent' action). */
export const fetchRecent = (cfg, limit = 300) => call(cfg, 'recent', { limit }).then((d) => d.leads || []);

/** Claude-written bullets for a batch of leads. {} when it is off or fails. */
export const fetchSpecifics = (cfg, leads) =>
  call(cfg, 'specifics', { leads }).then((d) => d.specifics || {});

/** Store the Anthropic key in Apps Script, or read back whether one is set. */
export const saveAiKey = (cfg, key) => call(cfg, 'aikey', { key });
export const clearAiKey = (cfg) => call(cfg, 'aikey', { clear: true });
export const aiKeyStatus = (cfg) => call(cfg, 'aikey', {});
export const setAiBudget = (cfg, budget) => call(cfg, 'aikey', { budget });

export const ping = (cfg) => call(cfg, 'ping');
