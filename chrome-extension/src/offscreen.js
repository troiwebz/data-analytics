// An MV3 service worker has no Audio and no DOM, so it cannot make a sound.
// This page exists only to play one. The worker creates it on the first alert
// and keeps it; Chrome tears it down with the extension.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen-audio') return;
  try {
    const audio = new Audio(chrome.runtime.getURL(`src/sounds/${msg.sound}.wav`));
    audio.volume = Math.max(0, Math.min(1, Number(msg.volume ?? 0.5)));
    audio.play().then(() => sendResponse({ ok: true }),
                      (e) => sendResponse({ ok: false, error: e.message }));
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
  return true;                       // the play promise settles after this returns
});
