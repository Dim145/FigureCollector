/**
 * Direction A title accent — the signature MangaCollector move: the leading
 * word set in hanko-red *italic* Fraunces, the remainder in ivoire. Turns a
 * plain heading ("Ma collection", "Vos pré-commandes", "La Cote") into the
 * editorial red-accent headline of the redesign.
 *
 * Put `.display` (Fraunces) on the heading itself; this only adds the colour
 * + italic on the first token — including single-word titles, whose sole token
 * still gets the accent (no special-case, so figure names read as headlines).
 */
export default function AccentTitle({ text, className = "" }) {
  const str = String(text ?? "");
  const space = str.indexOf(" ");
  const first = space === -1 ? str : str.slice(0, space);
  const rest = space === -1 ? "" : str.slice(space + 1);
  return (
    <span className={className}>
      <span className="italic text-[var(--color-laque-bright)]">{first}</span>
      {rest ? <> {rest}</> : null}
    </span>
  );
}
