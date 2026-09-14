/* Shared helpers for the content scripts. Injected before them, so it must be
 * a plain script, not a module. */

/**
 * Plain text -> HTML for XenForo's editor.
 *
 * A blank line in the source must survive as a blank line in the editor.
 * Wrapping each paragraph in <p> is not enough — the editor collapses the
 * margins and everything runs together — so an explicit empty paragraph goes
 * between them.
 */
globalThis.HAF_HTML = function (text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('<p><br></p>');
};
