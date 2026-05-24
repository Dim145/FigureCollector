/**
 * Infinite horizontal scroll. Pure CSS via `@keyframes marquee-scroll`
 * defined in `index.css`. The content gets duplicated inline so the
 * loop is seamless (the keyframe translates to -50% so the second copy
 * is in position when the first wraps).
 *
 * @param {React.ReactNode} children       Items to repeat
 * @param {number} [durationSeconds=60]    Full loop time
 * @param {string} [className=""]
 */
export default function Marquee({
  children,
  durationSeconds = 60,
  className = "",
}) {
  return (
    <div
      className={`marquee ${className}`}
      style={{ "--marquee-duration": `${durationSeconds}s` }}
      aria-hidden="true"
    >
      <div className="marquee__track">
        <div className="flex items-center shrink-0">{children}</div>
        <div className="flex items-center shrink-0">{children}</div>
      </div>
    </div>
  );
}
