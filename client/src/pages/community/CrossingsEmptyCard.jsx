import { Link } from "react-router-dom";
import Button from "../../components/Button.jsx";
import EmptyState from "../../components/EmptyState.jsx";

/**
 * The dormant states for /croisements, composing the shared `EmptyState`:
 *   · NotLinked  — no MangaCollector link yet (red, "affix the link")
 *   · NotActive  — linked but pending (gold) or revoked (red); features dormant
 * Both end on a single primary CTA into Settings.
 */
export function NotLinked({ t }) {
  return (
    <div className="max-w-xl mx-auto">
      <EmptyState
        kanji="交"
        hue="var(--color-laque-bright)"
        eyebrow={t("croisements.unlinked.eyebrow", { default: "AUCUN LIEN" })}
        title={t("manga.croisements.unlinked.title")}
        body={t("manga.croisements.unlinked.body")}
      >
        <Link to="/settings">
          <Button variant="primary">{t("manga.croisements.unlinked.cta")}</Button>
        </Link>
      </EmptyState>
    </div>
  );
}

/** Linked, but the server is pending or revoked — features are dormant. */
export function NotActive({ t, status, reason }) {
  const revoked = status === "revoked";
  // Revoked = error → hanko-red; pending = waiting → gold. Both within
  // Direction A (no indigo).
  const hue = revoked ? "var(--danger)" : "var(--accent)";
  return (
    <div className="max-w-xl mx-auto">
      <EmptyState
        kanji={revoked ? "禁" : "待"}
        hue={hue}
        eyebrow={
          revoked
            ? t("croisements.revoked.eyebrow", { default: "SERVEUR RÉVOQUÉ" })
            : t("croisements.pending.eyebrow", { default: "EN ATTENTE" })
        }
        title={
          revoked ? t("manga.croisements.revoked.title") : t("manga.croisements.pending.title")
        }
        body={
          revoked
            ? reason
              ? t("manga.croisements.revoked.body_reason", { reason })
              : t("manga.croisements.revoked.body")
            : t("manga.croisements.pending.body")
        }
      >
        <Link to="/settings">
          <Button variant="primary">{t("manga.croisements.unlinked.cta")}</Button>
        </Link>
      </EmptyState>
    </div>
  );
}
