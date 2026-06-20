/**
 * Profile avatar — the collector's photo in a gold-ringed disc, falling back to
 * a 像 ("statue / likeness") monogram on a noir well when none is set. Purely
 * decorative (the display name carries the accessible label), so the image is
 * `alt=""` / `aria-hidden`. Page-local to the public profile: the gold ring +
 * kanji monogram is the Direction-A signature here, distinct from the compact
 * `ui/Avatar` used in lists.
 */
export default function ProfileAvatar({ src, name }) {
  const ring = {
    boxShadow:
      "0 0 0 1px color-mix(in oklab, var(--color-or) 55%, transparent), 0 18px 40px -22px rgba(0,0,0,0.85)",
  };
  if (src) {
    return (
      <span
        className="block w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[var(--color-noir-deep)]"
        style={ring}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      title={name}
      className="grid place-items-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[var(--color-noir-deep)] ja text-4xl sm:text-5xl text-[var(--color-or)]/70 select-none"
      style={ring}
    >
      像
    </span>
  );
}
