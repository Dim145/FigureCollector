import { useEffect, useRef, useState } from "react";
import { Search, Link2, ScanBarcode, Sparkles } from "lucide-react";
import { Modal, Tabs, Input, Button } from "../ui/index.js";
import BarcodeScanner from "../BarcodeScanner.jsx";
import { useProxyEnabled } from "../../hooks/useProxy.js";
import LookupSearch from "./LookupSearch.jsx";
import LookupAniList from "./LookupAniList.jsx";
import MfcPasteImport from "./MfcPasteImport.jsx";
import LookupDetailModal from "./LookupDetailModal.jsx";
import {
  classifyInput,
  defaultProxyPick,
  fetchOrzgkDetail,
  fetchProxyProduct,
  isUrl,
  legacyPick,
} from "./lookupSources.js";

/**
 * The figure external-lookup, as a real <Modal> with source <Tabs>:
 *
 *   Recherche  — name search over orzgk + proxy boutiques (LookupSearch)
 *   Lien       — paste an orzgk / proxy-boutique product link
 *   Code-barres— scan or key a JAN/EAN (BarcodeScanner) → fills the JAN field
 *   AniList    — series search → fills series + enrichment (LookupAniList)
 *
 * Picking a search result (or pasting a link) opens the UNIFIED
 * <LookupDetailModal> (one wizard for both orzgk and proxy, via the source
 * adapter). On apply it hands the form-prefill payload to `onPick` and closes.
 *
 * Replaces the old inline panel + the two near-duplicate detail wizards +
 * the separate MFC paste modal that all lived in one 1444-line FigureLookup.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(payload: object) => void} props.onPick
 * @param {string} [props.initial]   seed query (the figure name typed so far)
 * @param {(key, opts?) => string} props.t
 */
export default function FigureLookupModal({ open, onClose, onPick, initial = "", t }) {
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState(initial);
  const [linkValue, setLinkValue] = useState("");
  const proxy = useProxyEnabled();

  // Detail-flow state (when a result is picked or a link resolved).
  const [detail, setDetail] = useState(null); // payload
  const [detailFor, setDetailFor] = useState(null); // url
  const [detailSource, setDetailSource] = useState("orzgk");
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Re-seed the query when the modal (re)opens with a fresh figure name.
  useEffect(() => {
    if (open) setQuery(initial);
  }, [open, initial]);

  // Monotonic token: a slow earlier fetch must never clobber a fresh later one.
  const reqRef = useRef(0);

  const closeDetail = () => {
    setDetailFor(null);
    setDetail(null);
    setDetailError(null);
    setDetailBusy(false);
  };

  const apply = (payload) => {
    onPick(payload);
    closeDetail();
    onClose();
  };

  const openOrzgkDetail = (url) => {
    const my = ++reqRef.current;
    setDetailSource("orzgk");
    setDetailFor(url);
    setDetail(null);
    setDetailError(null);
    setDetailBusy(true);
    fetchOrzgkDetail(url).then(
      (d) => {
        if (reqRef.current !== my) return;
        setDetail(d);
        setDetailBusy(false);
      },
      (e) => {
        if (reqRef.current !== my) return;
        setDetailError(e?.message ?? "Detail fetch failed");
        setDetailBusy(false);
      },
    );
  };

  const openProxyProduct = (url) => {
    const my = ++reqRef.current;
    setDetailSource("proxy");
    setDetailFor(url);
    setDetail(null);
    setDetailError(null);
    setDetailBusy(true);
    fetchProxyProduct(url).then(
      (p) => {
        if (reqRef.current !== my) return;
        // >1 version → open the picker; otherwise fast-import the default.
        if (p.versions?.length > 1) {
          setDetail(p);
          setDetailBusy(false);
        } else {
          apply(defaultProxyPick(p));
        }
      },
      (e) => {
        if (reqRef.current !== my) return;
        setDetailError(e?.message ?? "proxy lookup failed");
        setDetailBusy(false);
      },
    );
  };

  // Route any URL (typed in the Lien tab, or pasted into the search box) to the
  // right resolver. Non-URLs in the search box are left for the name search.
  const dispatchInput = (raw) => {
    const c = classifyInput(raw, proxy);
    if (c.kind === "orzgk-url") openOrzgkDetail(c.value);
    else if (c.kind === "proxy-url") openProxyProduct(c.value);
    return c.kind;
  };

  // A pasted URL in the SEARCH box jumps straight to detail (parity with the
  // old inline panel). The search panel itself only does the name search.
  const onSearchQueryChange = (next) => {
    setQuery(next);
    if (isUrl(next) && next.trim() !== detailFor) dispatchInput(next);
  };

  // Result row pick → open the unified wizard (or fast-import a detail-less row).
  const onPickRow = (row) => {
    if (row.source === "orzgk" && row.detail_url) openOrzgkDetail(row.detail_url);
    else if (row.source === "proxy" && row.detail_url) openProxyProduct(row.detail_url);
    else apply(legacyPick(row, t));
  };

  const submitLink = (e) => {
    e.preventDefault();
    const v = linkValue.trim();
    if (!v) return;
    dispatchInput(v);
  };

  const tabs = [
    { value: "search", label: t("lookup.tab.search", { default: "Recherche" }), icon: Search },
    { value: "link", label: t("lookup.tab.link", { default: "Lien" }), icon: Link2 },
    {
      value: "barcode",
      label: t("lookup.tab.barcode", { default: "Code-barres" }),
      icon: ScanBarcode,
    },
    { value: "anilist", label: t("lookup.tab.anilist", { default: "AniList" }), icon: Sparkles },
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t("lookup.figure.modal_title", { default: "Pré-remplir depuis une source" })}
        description={t("lookup.figure.modal_desc", {
          default:
            "Cherchez, collez un lien ou scannez un code-barres. Les champs trouvés se pré-remplissent — vous gardez la main sur tout.",
        })}
      >
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />

        {tab === "search" ? (
          <LookupSearch
            query={query}
            onQueryChange={onSearchQueryChange}
            onPickRow={onPickRow}
            t={t}
          />
        ) : null}

        {tab === "link" ? (
          <form onSubmit={submitLink} className="space-y-4">
            <p className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3">
              {t("lookup.figure.link_note", {
                default:
                  "Collez un lien produit orzgk ou d'une boutique prise en charge par le proxy. La fiche s'ouvre pour choisir version et prix.",
              })}
            </p>
            <div className="relative">
              <Link2
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)]"
                aria-hidden
              />
              <Input
                autoFocus
                type="url"
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="https://orzgk.com/product/…"
                className="pl-9"
                aria-label={t("lookup.tab.link", { default: "Lien" })}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={!linkValue.trim()}>
                {t("lookup.figure.link_open", { default: "Ouvrir la fiche" })}
              </Button>
            </div>

            {/* MFC sits with the link flow — it's also a paste-to-import path,
                just HTML instead of a URL (its scrape is Cloudflare-blocked). */}
            <div className="pt-4 border-t border-[var(--border-subtle)]">
              <p className="micro-tight mb-3 flex items-center gap-2 text-[var(--color-or-pale)]">
                <span
                  aria-hidden
                  className="ja not-italic text-[var(--accent)] text-xs leading-none"
                >
                  輸
                </span>
                {t("mfc.title")}
              </p>
              <MfcPasteImport onApply={apply} t={t} />
            </div>
          </form>
        ) : null}

        {tab === "anilist" ? <LookupAniList onPick={apply} initial={query} t={t} /> : null}

        {/* Barcode: the panel explains, the scanner mounts as its own overlay. */}
        {tab === "barcode" ? <BarcodeTab onDetect={(code) => apply({ jan: code })} t={t} /> : null}
      </Modal>

      {/* Unified detail wizard — same component for orzgk + proxy. */}
      {detailFor ? (
        <LookupDetailModal
          source={detailSource}
          url={detailFor}
          detail={detail}
          busy={detailBusy}
          error={detailError}
          onClose={closeDetail}
          onApply={apply}
          t={t}
        />
      ) : null}
    </>
  );
}

/** Barcode tab: a short explainer + a button that mounts the shared
 *  <BarcodeScanner> (its own fullscreen overlay with camera + manual entry). */
function BarcodeTab({ onDetect, t }) {
  const [scanning, setScanning] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3">
        {t("lookup.figure.barcode_note", {
          default:
            "Scannez le code-barres de la boîte (ou saisissez-le) — il renseigne le champ JAN/EAN de la fiche.",
        })}
      </p>
      <Button
        variant="primary"
        type="button"
        iconStart={<ScanBarcode size={16} />}
        onClick={() => setScanning(true)}
      >
        {t("scan.title")}
      </Button>
      {scanning ? (
        <BarcodeScanner
          onDetect={(code) => {
            setScanning(false);
            onDetect(code);
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </div>
  );
}
