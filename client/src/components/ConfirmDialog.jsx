import { useT } from "../i18n/index.jsx";
import Button from "./Button.jsx";
import Modal from "./ui/Modal.jsx";

/**
 * One confirmation dialog reused across the app. Now built on the shared
 * <Modal> (focus-trap, Esc/backdrop close, focus restore) — same API as before
 * so existing call-sites are unchanged.
 *
 * Props: open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel,
 *        destructive (→ danger button), busy (disables/loads the primary).
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={body}
      size="sm"
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t("editor.cancel")}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={busy}
            data-autofocus
          >
            {confirmLabel ?? t("editor.confirm") ?? "OK"}
          </Button>
        </>
      }
    />
  );
}
