import { useState } from "react";
import { Gift } from "lucide-react";
import { Button, Modal } from "../../components/ui/index.js";
import { useGiftShare } from "../../hooks/useGiftList.js";
import GiftSharePanel from "../../components/GiftSharePanel.jsx";

/**
 * Makes gift-share VISIBLE on Souhaits: a clear "Partager ma liste cadeau"
 * action that opens the existing GiftSharePanel (compose-only) in a Modal.
 * Reads the share state so the button label reflects whether a link already
 * exists — but all mint/copy/disable logic stays inside GiftSharePanel.
 */
export default function GiftShareSection({ t }) {
  const [open, setOpen] = useState(false);
  const share = useGiftShare();
  const active = !!share.data?.enabled && !!share.data?.token;

  return (
    <>
      <div
        className="flex flex-wrap items-center justify-between gap-4 p-5"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-raised)",
          backgroundImage:
            "linear-gradient(155deg, color-mix(in oklab, var(--accent) 4%, transparent) 0%, transparent 38%)",
        }}
      >
        <div className="min-w-0">
          <p className="micro flex items-center gap-2">
            <span aria-hidden className="ja not-italic text-[var(--accent)]">
              贈
            </span>
            {t("gift.eyebrow")}
          </p>
          <h2 className="display text-xl text-[var(--on-surface)] mt-1.5">
            {t("gift.share_title")}
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--on-surface-muted)] max-w-md leading-relaxed">
            {t("gift.share_body")}
          </p>
        </div>
        <Button
          variant={active ? "ghost" : "primary"}
          size="sm"
          iconStart={<Gift size={16} />}
          className="uppercase shrink-0"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {active
            ? t("wishlist.gift.manage", { default: "Gérer le lien cadeau" })
            : t("wishlist.gift.open", { default: "Partager ma liste cadeau" })}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t("gift.share_title")} size="lg">
        <GiftSharePanel />
      </Modal>
    </>
  );
}
