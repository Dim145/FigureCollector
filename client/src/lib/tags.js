// Appearance-tag helpers (client side).
//
// Tags come from the server as one comma-separated string per figure
// (`visual_tags`). The GENERIC set mirrors `server/src/domain/tags.rs`
// GENERIC_TAGS — ultra-common tags hidden from chips + pickers (they stay
// searchable via `?tag=`). Keep the two lists roughly in sync.

const GENERIC = new Set([
  "1girl", "2girls", "3girls", "4girls", "6+girls", "multiple girls",
  "1boy", "2boys", "multiple boys", "solo", "solo focus",
  "looking at viewer", "looking away", "looking to the side", "looking back",
  "simple background", "white background", "grey background", "gray background",
  "black background", "transparent background", "gradient background",
  "full body", "upper body", "lower body", "cowboy shot", "portrait",
  "standing", "blush", "smile", "open mouth", "closed mouth", "parted lips",
  "holding", "official art", "artist name", "signature", "watermark",
  "web address", "english text", "commentary", "commentary request",
]);

/** Split a `visual_tags` string into deduped, lowercased, trimmed tags. */
export function parseTags(raw) {
  const seen = new Set();
  const out = [];
  for (const part of (raw || "").split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Tags worth showing as chips/filters: parsed, generic tags dropped, capped. */
export function displayTags(raw, { max = 24 } = {}) {
  return parseTags(raw)
    .filter((tag) => !GENERIC.has(tag))
    .slice(0, max);
}

// High-precision explicit tags from the WD-Tagger vocabulary. Used ONLY to
// *suggest* the NSFW flag in the editor — never to auto-set it. Deliberately
// conservative: only unambiguous adult tags, so merely suggestive ones
// (swimsuit, cleavage, bikini, lingerie) never raise a false NSFW nudge.
const NSFW = new Set([
  "nude", "completely nude", "topless", "bottomless", "naked",
  "nipples", "areolae", "areola slip", "nipple slip", "no bra", "no panties",
  "pussy", "spread pussy", "vaginal", "clitoris", "pubic hair",
  "anus", "anal", "penis", "testicles", "futanari",
  "cum", "cum on body", "cumdrip", "ejaculation", "after sex",
  "sex", "vaginal sex", "fellatio", "oral", "cunnilingus", "paizuri",
  "masturbation", "sex toy", "dildo", "vibrator", "double penetration",
  "censored", "uncensored", "bdsm", "bondage",
]);

/** Explicit tags present in a figure's `visual_tags` — drives the editor's
 *  "this looks NSFW" nudge. Returns the matched tags (empty array = nothing
 *  flagged), so the UI can both decide whether to show the nudge and name the
 *  tags that triggered it. */
export function nsfwTags(raw) {
  return parseTags(raw).filter((tag) => NSFW.has(tag));
}
