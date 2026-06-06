/**
 * Direction A title accent — the signature MangaCollector move: the leading
 * word set in hanko-red *italic* Fraunces, the remainder in ivoire. Turns a
 * plain heading ("Ma collection", "Vos pré-commandes", "La Cote") into the
 * editorial red-accent headline of the redesign.
 *
 * Put `.display` (Fraunces) on the heading itself; this only adds the colour
 * + italic on the first token. Single-word titles render unchanged so it
 * degrades gracefully across locales.
 */
export default function AccentTitle({ text, className = "" }) {
  const str = String(text ?? "");
  const space = str.indexOf(" ");
  if (space === -1) {
    return <span className={className}>{str}</span>;
  }
  const first = str.slice(0, space);
  const rest = str.slice(space + 1);
  return (
    <span className={className}>
      <span className="italic text-[var(--color-laque-bright)]">{first}</span>{" "}
      {rest}
    </span>
  );
}
