// Keeping the service worker alive through a long job.
//
// MV3 kills a service worker after 30 seconds with no extension-API activity.
// Awaiting a fetch, a setTimeout, or a message from a content script is not
// activity, and posting does all three: up to 30s waiting for the tab to load,
// a 1-3s human pause, then up to 45s waiting for the content script to report
// back. That is comfortably past the budget.
//
// On a desktop it usually survives anyway, because the open dashboard is
// talking to the worker and every one of those messages resets the idle timer.
// On a machine nobody is touching - a server - nothing resets it, so the worker
// is killed in the middle of the job. There is no error and no log line,
// because the code that would have written one dies with it. The tab is left
// open, the lead is left unmarked, and Telegram is left waiting for an answer
// that will never come.
//
// The documented way out is to call an extension API on a timer. getPlatformInfo
// is the cheapest one that touches no state of ours.
let holders = 0;
let timer = null;

const TICK_MS = 20000;           // comfortably inside the 30s idle timeout

function tick() {
  // The result is thrown away; making the call is the entire point.
  chrome.runtime.getPlatformInfo?.().catch(() => {});
}

/**
 * Run `fn` with the worker held awake.
 *
 * Reference counted, so two jobs overlapping do not cancel each other's hold,
 * and always released - a throw must not leave the worker pinned forever.
 */
export async function alive(fn) {
  holders++;
  if (!timer) timer = setInterval(tick, TICK_MS);
  try {
    return await fn();
  } finally {
    holders = Math.max(0, holders - 1);
    if (!holders && timer) { clearInterval(timer); timer = null; }
  }
}

/** For tests and the diagnostics panel. */
export const held = () => holders;
