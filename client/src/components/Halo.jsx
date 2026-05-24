/**
 * Direction B — radial gold halo, positioned absolutely behind hero content.
 * Pass `intensity` between 0 and 1 (default 0.18) to fine-tune.
 */
export default function Halo({ intensity = 0.18, className = "" }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        background: `radial-gradient(closest-side at 50% 45%, oklch(0.78 0.10 80 / ${intensity}), transparent 70%)`,
      }}
    />
  );
}
