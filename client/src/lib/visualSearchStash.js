// One-shot hand-off of a captured photo between the catalogue search bar and
// the /recognize page.
//
// A File/Blob can't ride through a URL or sessionStorage, and stuffing a
// multi-MB photo into history.state risks the browser's pushState size limits.
// So we keep it in a module-level slot: the catalogue camera button stashes the
// File and navigates to /recognize, which takes it on mount and runs the search.
// Ephemeral by design — a hard reload of /recognize simply clears it (the page
// then shows its normal "capture a photo" state).

let _file = null;

/** Stash the captured photo for /recognize to pick up next. */
export function stashCapturedFile(file) {
  _file = file ?? null;
}

/** Read the stashed photo (or null). Pair with `clearCapturedFile` to consume. */
export function getCapturedFile() {
  return _file;
}

/** Drop the stashed photo once consumed (or to cancel the hand-off). */
export function clearCapturedFile() {
  _file = null;
}
