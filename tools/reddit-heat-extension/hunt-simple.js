// The three folds of the simpler hunt page: More, Settings and Filters.
// Only opens and closes things; every button inside keeps its own handler in hunt.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "huntSimple";
  let saved = {};
  const store = (patch) => { saved = { ...saved, ...patch }; try { chrome.storage.local.set({ [KEY]: saved }); } catch (_) { /* preview */ } };

  function fold(btn, box, name, remember) {
    const set = (open) => {
      box.hidden = !open;
      btn.classList.toggle("on", open);
      btn.setAttribute("aria-expanded", String(open));
      if (remember) store({ [name]: open });
    };
    btn.addEventListener("click", (e) => { e.stopPropagation(); set(box.hidden); });
    return set;
  }
  const setMore = fold($("moreBtn"), $("morePanel"), "more", true);
  const setFilters = fold($("filtersBtn"), $("filtersBox"), "filters", true);
  const setSettings = fold($("setBtn"), $("setMenu"), "settings", false);

  // Settings is a menu: a choice closes it, and so does a click anywhere else or Escape.
  $("setMenu").addEventListener("click", () => setSettings(false));
  document.addEventListener("click", (e) => { if (!$("setMenu").hidden && !e.target.closest(".menuWrap")) setSettings(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSettings(false); });

  // The Filters button says how many filters are on, so a folded filter is never a mystery.
  const selects = [...$("filtersBox").querySelectorAll("select")];
  const count = () => {
    const n = selects.filter((s) => s.value).length;
    $("filtersBtn").textContent = n ? `Filters · ${n} on` : "Filters";
    $("filtersBtn").classList.toggle("on", n > 0 || !$("filtersBox").hidden);
  };
  for (const s of selects) s.addEventListener("change", count);
  $("fClear").addEventListener("click", () => setTimeout(count, 0));
  setInterval(count, 2000);   // hunt.js restores saved filters on load

  // On the queue itself the top search already filters it, and there is
  // nothing to go back to: hide the table's own search and back button there.
  const markQueue = () => {
    const t = $("tableTitle");
    document.body.classList.toggle("onQueue", !!t && /^\s*Queue\b/.test(t.textContent || ""));
  };
  if ($("tableTitle")) new MutationObserver(markQueue).observe($("tableTitle"), { childList: true, characterData: true, subtree: true });
  markQueue();

  try {
    chrome.storage.local.get([KEY], (x) => {
      saved = (x && x[KEY]) || {};
      if (saved.more) setMore(true);
      if (saved.filters) setFilters(true);
      count();
    });
  } catch (_) { count(); }
})();
