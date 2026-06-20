// Insurance dossier — the inventory cover (the SAME jsPDF generator used by the
// plain inventory export) merged SERVER-SIDE with each figurine's uploaded
// invoices into ONE PDF. The merge — and the decryption of store-locked invoice
// PDFs that a browser PDF lib can't handle — happens on the server; here we just
// build the cover, post it with a manifest of localized titles/labels, and
// stream the merged file back.

import { exportInventoryPdf } from "./inventoryExport.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build the inventory cover, POST it + a manifest to the merge endpoint, and
 * download the returned dossier PDF. Throws on a failed request (the caller
 * surfaces the message). The server decides which items actually have documents
 * and gates ownership — we just send every item in display order.
 */
export async function exportInsuranceDossier(owned, stats, t, { ownerName } = {}) {
  // 1. Reuse the existing inventory generator for the cover → ArrayBuffer.
  const coverBuf = await exportInventoryPdf(owned, stats, t, {
    ownerName,
    returnDoc: true,
  });
  const cover = new Blob([coverBuf], { type: "application/pdf" });

  // 2. Manifest: items in display order + the localized separator strings the
  //    server interpolates (so it owns no i18n itself).
  const items = (owned || [])
    .filter((o) => o?.id)
    .map((o) => ({
      owned_id: o.id,
      title: [o.figure_name, o.manufacturer_name].filter(Boolean).join(" — "),
    }));
  const manifest = {
    items,
    labels: {
      kicker: t("export.dossier.kicker", { default: "JUSTIFICATIFS" }),
      documents: t("export.dossier.documents", { default: "justificatif(s)" }),
      paid: t("export.dossier.paid", { default: "Total payé" }),
      purchased_on: t("export.dossier.purchased_on", { default: "le" }),
      unreadable: t("export.dossier.unreadable", { default: "Justificatif illisible" }),
    },
  };

  // 3. POST multipart → merged PDF blob.
  const fd = new FormData();
  fd.append("cover", cover, "cover.pdf");
  fd.append("manifest", JSON.stringify(manifest));

  const res = await fetch("/api/me/export/insurance-dossier", {
    method: "POST",
    body: fd,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.message || j.error || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `figurecollector-dossier-assurance-${date}.pdf`);
}
