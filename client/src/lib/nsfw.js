// Single source of truth for the SPA-side NSFW decision tree.
//
// Backend already filters the lists when pref is "hide". The frontend uses
// these helpers for things the server can't reach: direct figure URL
// interstitials, applying the blur class on images, disabling upload UI.

/** Three lifecycle outcomes for a figure given the viewer's preference. */
export function nsfwMode(figureIsNsfw, pref) {
  if (!figureIsNsfw) return "ok";
  switch (pref) {
    case "show":  return "ok";
    case "blur":  return "blur";
    case "hide":
    default:      return "hide";
  }
}

/** Class suffix for img/video tags. Add `nsfw-blur` when needed. */
export function nsfwClass(figureIsNsfw, pref) {
  return nsfwMode(figureIsNsfw, pref) === "blur" ? "nsfw-blur" : "";
}

/** Should the SPA refuse to display the figure altogether? */
export function nsfwBlocked(figureIsNsfw, pref) {
  return nsfwMode(figureIsNsfw, pref) === "hide";
}

/** Should we disable the upload UI on this figure? */
export function nsfwUploadBlocked(figureIsNsfw, pref) {
  return figureIsNsfw && pref === "blur";
}
