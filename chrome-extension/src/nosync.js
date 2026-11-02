// Her copy (1.24.1): Chrome Sync is never read or written. If her Chrome is signed in to the same Google
// account as another HAF Watcher, Sync would hand her that copy's settings, style, keys and bot on install.
// Everything stays in this Chrome's local storage instead.
export const NOSYNC = {
  get: async () => ({}),
  set: async () => {},
  remove: async () => {},
  clear: async () => {},
  getBytesInUse: async () => 0
};
