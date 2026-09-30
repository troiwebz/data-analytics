// A fake chrome.* for rendering the extension's pages in an ordinary browser tab.
// Answers every message the hunt page sends with realistic sample data.
(function () {
  const now = Date.now(), H = 3600000;
  const raw = [
    ["cofounder", "cofounderhunt", "Technical / Quant Co-Founder Wanted - U.S. Bank Early-Warning Risk Intelligence", "I have 11 years in credit risk at two US banks and a working prototype that flags distressed borrowers 60 days early. I need a technical co-founder to own the platform. Pre-revenue, two banks in pilot talks. Equity split negotiable, I fund infra.", 0.12, 3],
    ["cofounder", "cofounderhunt", "Need cofounder for my startup", "Company owner in Pune, we run a logistics business with revenue and want to build a SaaS for small fleet owners. Looking for a technical cofounder who can build the MVP. Based in India.", 1, 6],
    ["cofounder", "startups", "Looking for a Commercial Co-Founder for an early-revenue B2B SaaS", "We have $4k MRR from 30 clinics in Brazil. I am technical and built the product; I need a commercial partner to run sales and marketing. Remote is fine.", 1.2, 14],
    ["hiring", "forhire", "[Hiring] Python developer to build a price scraper, $400 fixed", "Need a scraper for 12 retail sites, daily CSV export to Google Drive. Budget $400 fixed, 2 weeks. DM me with similar work.", 0.3, 2],
    ["hiring", "forhire", "[HIRING] Local SEO for a plumbing company - Google Business Profile", "Plumber in Austin TX. Our GBP dropped out of the map pack. Need someone to fix the listing, citations and reviews flow. $300/month to start.", 0.6, 4],
    ["hiring", "hiring", "[Hiring] Facebook ads manager for a dental clinic", "Two-location dental clinic in Leeds. Want a paid social person to run Meta ads for Invisalign leads. $1500/mo retainer. PM me.", 2, 9],
    ["cofounder", "cofounderhunt", "[Cofounder/Growth Partner] Equity-based growth role for a frontend-heavy SaaS", "Looking for a growth partner, equity only, no salary. I am a frontend developer in Bangalore with a beta.", 2.1, 21],
    ["problem", "smallbusiness", "Our Google Maps listing vanished after we moved - calls stopped", "We run a bakery and after moving two streets our Google Business Profile got suspended. Nobody can find us on maps now and the phone stopped ringing.", 3, 11],
    ["cofounder", "SaaS", "Non-technical founder, need a CTO for an AI bookkeeping tool", "I am an accountant with 40 firms on a waitlist. I cannot code. Looking for a technical co-founder, I have a small budget for infra and can pay a stipend.", 4, 5],
    ["hiring", "slavelabour", "[Task] Fix a WordPress checkout bug - $50", "WooCommerce checkout throws an error on mobile Safari. $50, today if possible.", 5, 7],
  ];
  const posts = {};
  function build() {
    if (Object.keys(posts).length || !self.classifyAny) return;
    raw.forEach(([want, sub, title, body, ageH, comments], i) => {
      const src = want === "cofounder" ? "cofounder" : want === "hiring" ? "hiring" : "project";
      const c = self.classifyAny(title, body, src) || {};
      const id = "t3_demo" + i;
      posts[id] = { id, author: ["Western-Advice-1053", "Substantial-Age-6298", "Mediocre_Cod_7374", "scrape_buyer", "austin_plumb", "leeds_smiles", "vmsamuvel", "bakery_owner_uk", "ledger_founder", "shopfix22"][i],
        sub, title, body, permalink: "https://www.reddit.com/r/" + sub + "/comments/demo" + i + "/x/", created: now - ageH * H, firstSeen: now - ageH * H + 60000,
        comments, ups: 3, hunt: src === "cofounder" ? "cofounder" : "project", source: src === "hiring" ? "hiring" : "",
        badge: c.badge || (want === "problem" ? "problem" : want), tier: c.tier || 2, kind: c.kind || "", budget: c.budget || "",
        role: c.role, stage: c.stage, equityOnly: c.equityOnly, hasBudget: c.hasBudget };
    });
  }
  const store = { config: { profile: { name: "Hema", role: "web developer", reddit: "Noah_Basera", aiEngine: "slots", dmCap: 25 } }, autoSend: true, autoSendSecs: 10, theme: "dark" };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function answer(m) {
    build();
    const list = Object.values(posts).map((p) => ({ ...p, score: self.huntScore ? self.huntScore(p, Date.now()) : 40 }));
    const badges = {}; for (const p of list) badges[p.badge] = (badges[p.badge] || 0) + 1;
    switch (m.type) {
      case "hunt-queue": return { queue: list, total: list.length, blocked: 0, later: 0, dupes: 40, aiCancelled: 0, doneToday: 2, doneYesterday: 0, newSince: 4, lastDone: 0,
        lastReport: "scanned 966 posts in 8 subreddits + 2 searches · 0 new co-founder asks · 20 new projects", lastBulk: null, undoReset: 0, skippedTotal: 0, rejectTotal: 398,
        badges, spend: { day: "x", cents: 0, budget: 100 }, lastBackupAt: now - 2 * H, schedule: 3, scheduleAll: 3, scheduleSent: 0, scheduleNext: now + 4 * 60000,
        contactedTotal: 0, contactedToday: 0, on: true, server: null, stale: 0, maxAgeH: 48, me: "Noah_Basera", lastPoll: now - 60000, lastError: "", found: 299,
        hiringLane: { at: now - 30000, seen: 180, added: 1, error: "" } };
      case "ap-get": return { ok: true, on: true, blocked: "no Claude key saved - add it under AI writing on the hunt page", rules: {}, nextAt: 0, watchLeft: 3, screened: 0, sentAuto: 0,
        hasToken: false, chatId: "", job: null, log: [], since: now - H, tgError: "", gate: { ok: true, sentToday: 0, cap: 25, waitMs: 0 }, huntOn: true, hasKey: false, waiting: 2 };
      case "version-state": return { running: "4.15.0", onDisk: "4.15.0", remote: "4.15.0", remoteCheckedAt: now, diskAhead: false, remoteAhead: false, busy: false };
      case "hunt-scan-state": return { running: false };
      case "hunt-spend": return { cents: 0, budget: 100, rows: [], byKind: [] };
      case "hunt-dm-gate": return { ok: true, waitMs: 0, sentToday: 0, cap: 25, min: 60, max: 180 };
      case "hunt-schedule-list": {
        const row = (p, o) => ({ id: p.id, kind: "dm", at: now + (o.inMin || 0) * 60000, state: o.state || "waiting", reason: o.reason || "", openedAt: 0, sentAt: o.state === "sent" ? now - 60000 : 0, title: p.title, author: p.author, sub: p.sub, permalink: p.permalink, written: !!o.written, gone: false });
        const ps = Object.values(posts);
        const rows = ps.length ? [row(ps[3], { state: "sent", inMin: -3, written: true }), row(ps[4], { state: "cancelled", inMin: -1, reason: "Claude read it: asks the applicant to pay a setup fee" }), row(ps[5], { inMin: 1, written: true }), row(ps[9], { inMin: 6 })] : [];
        return { rows, counts: { waiting: 2, opened: 0, sent: 1, cancelled: 1, gone: 0, done: 0 }, waiting: 2, next: 60000, nextAt: now + 60000, gateWaitMs: 0, gateReason: "" };
      }
      case "inbox-list": return { threads: [], needs: 2 };
      case "hunt-campaign-status": return { ok: true, running: { id: "c1", startedAt: now - H, state: "running", plannedDms: 15, dmsSent: 4, dmsWaiting: 10, dmsOpen: 1, dmsDropped: 0 } };
      case "hunt-campaign-get": return {};
      case "hunt-done": return { rows: [{ id: "t3_sentA", title: "Looking for a growth/marketing cofounder to build a portfolio of apps", sub: "cofounderhunt", author: "Exact_Permit_7471", at: now - 20 * 60000, dmAt: now - 20 * 60000 }, { id: "t3_sentB", title: "[Hiring] LinkedIn Outreach Partner - Remote - US$50/month", sub: "forhire", author: "Acesleychan", at: now - 5 * 60000, dmAt: now - 5 * 60000 }] };
      case "hunt-whoami": return { me: "Noah_Basera" };
      default: return { ok: true };
    }
  }
  const ev = () => ({ addListener() {}, removeListener() {} });
  self.chrome = {
    runtime: {
      id: "preview", lastError: null, getURL: (p) => p, getManifest: () => ({ version: "4.15.0" }), reload() {}, connectNative() { return { onMessage: ev(), onDisconnect: ev(), postMessage() {} }; },
      sendMessage(m, cb) { const r = answer(m || {}); if (typeof cb === "function") { setTimeout(() => cb(clone(r)), 5); return; } return Promise.resolve(clone(r)); },
      onMessage: ev(),
    },
    storage: { local: {
      get(keys, cb) { const o = {}; const ks = keys == null ? Object.keys(store) : [].concat(keys); for (const k of ks) if (k in store) o[k] = clone(store[k]); if (cb) { cb(o); return; } return Promise.resolve(o); },
      set(o, cb) { Object.assign(store, clone(o)); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { for (const x of [].concat(k)) delete store[x]; if (cb) { cb(); return; } return Promise.resolve(); },
    }, onChanged: ev() },
    tabs: { create(o) { window.open(o.url, "_blank"); return Promise.resolve({ id: 1 }); } },
  };
})();
