import { Modal, Button } from "../../components/ui/index.js";

/**
 * Help for the catalogue search modes — opened by the discreet "?" IconButton
 * by the mode control. Composes the shared Modal (focus-trap, Esc + backdrop
 * close, scroll-lock) and keeps the Direction-A editorial body (kanji eyebrow,
 * gold-rule, per-mode glyph list). Only describes the modes the toggle actually
 * offers (admin gating via `vsStatus`).
 */
export default function SearchModesHelpModal({ open, onClose, t, vsStatus }) {
  const modes = [
    {
      kanji: "字",
      key: "help_keyword",
      default: "Mots-clés — recherche exacte dans les noms, séries et fabricants.",
    },
    ...(vsStatus?.text_search_enabled
      ? [
          {
            kanji: "意",
            key: "help_semantic",
            default:
              "Description — par le sens : un nom, une série, une matière, ou un mot dans une autre langue ; et l'allure si les tags d'apparence sont activés.",
          },
        ]
      : []),
    ...(vsStatus?.clip_search_enabled
      ? [
          {
            kanji: "似",
            key: "help_look",
            default:
              "Apparence — recherche visuelle : décris l'allure, on la compare à l'image des figurines.",
          },
        ]
      : []),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("common.got_it", { default: "Compris" })}
        </Button>
      }
    >
      <header className="mb-4">
        <p className="micro flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            探
          </span>
          {t("browse.search.help_eyebrow", { default: "Modes de recherche" })}
        </p>
        <h3 className="display text-2xl text-[var(--color-ivoire)] mt-1">
          {t("browse.search.help_title", { default: "Trois façons de chercher" })}
        </h3>
        <div className="gold-rule w-16 mt-3" />
      </header>
      <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-ivoire-soft)]">
        {modes.map((m) => (
          <li key={m.key} className="flex gap-3">
            <span aria-hidden className="ja not-italic text-[var(--color-or)]/80 mt-0.5">
              {m.kanji}
            </span>
            <span>{t(`browse.search.${m.key}`, { default: m.default })}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
