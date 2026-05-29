/**
 * Aurora atmosphere — a fixed, STATIC field of soft colour glows behind all
 * content (mounted once in AppShell). Purely decorative (aria-hidden).
 *
 * It used to drift + blur four screen-blended layers every frame, which was the
 * single biggest GPU cost on the site. It's now a plain static mesh (no
 * animation, no blur, no blend — see `.aurora-bg` / `.aurora-blob` in
 * index.css), rasterised once and reused as a fixed layer, so it costs ~0 GPU.
 */
export default function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden>
      <span className="aurora-blob b1" />
      <span className="aurora-blob b2" />
      <span className="aurora-blob b3" />
      <span className="aurora-blob b4" />
    </div>
  );
}
