//! Justificatif (invoice / receipt) parsing — **Palier 1**.
//!
//! Pure-Rust, in-binary, offline, free. We pull the PDF *text layer* with
//! `pdf-extract` (no native deps → links cleanly into the FROM-scratch image,
//! memory-safe — no libpoppler CVE surface) and mine it with label-anchored
//! heuristics. There is deliberately **no OCR** here: image / scanned receipts
//! carry no text layer and fall back to manual entry (OCR is a deferred,
//! opt-in palier). Parsing only ever *suggests* — the caller decides whether
//! to apply anything to the owned item, honouring the project's "manual entry
//! must always be possible" rule.
//!
//! A figurine pre-order typically spans several invoices (deposit, balance,
//! freight). Each parsed document yields a [`ParsedInvoice`]; [`compute_rollup`]
//! aggregates every parsed document on one item into a [`Rollup`] — the
//! "total payé" (articles vs shipping) the UI proposes. The common grouping key
//! is the owned item itself (the documents are already attached to it); the
//! order number, when present, is surfaced as a confidence signal.

use chrono::NaiveDate;
use regex::Regex;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::LazyLock;

/// Synchronous, CPU-bound PDF text-layer extraction. Call from
/// `tokio::task::spawn_blocking` so it never blocks the async runtime.
/// Returns the raw text, or a short error string on a malformed PDF.
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| e.to_string())
}

// --- Heuristic field extractors (label-anchored regexes over the text) -------

static RE_INVOICE_NO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)invoice\s+number\s+([A-Za-z0-9][A-Za-z0-9._/\-]*)").unwrap()
});
/// Fallback when OCR reordering splits the "Invoice Number" label from its
/// value (common on rasterised receipts): a bare invoice token anywhere, e.g.
/// "#INV-67736593", "INV-1234", "FAC-2401".
static RE_INVOICE_NO_BARE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)#?\s*(INV[-_]?\d{4,}|[A-Z]{2,5}-\d{4,})").unwrap());
static RE_ORDER_NO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)order\s*[:#]?\s*(\d{4,})").unwrap());
static RE_TXN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)transaction\s+id\s+([A-Za-z0-9]{6,})").unwrap());
static RE_PAY_METHOD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)payment\s+method\s+(.+?)\s+(?:transaction|total|invoice|paid|subtotal)\b")
        .unwrap()
});
static RE_TOTAL_AMOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)total\s+amount\s+([$€£¥])?\s*([0-9][0-9.,]*)").unwrap()
});
static RE_TOTAL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\btotal\b\s+([$€£¥])?\s*([0-9][0-9.,]*)").unwrap());
static RE_INVOICE_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)invoice\s+date\s+([0-9/\-]{8,10})").unwrap());
static RE_PAID_ON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)paid\s+on\s+([0-9/\-]{8,10})").unwrap());
static RE_ISO_CUR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(USD|EUR|GBP|JPY|CNY|RMB|CAD|AUD|HKD|KRW|CHF|SGD|TWD)\b").unwrap()
});
static RE_FROM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)^\s*from:\s*(.+)$").unwrap());
static RE_TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)^\s*(.+?)\s+invoice\s*$").unwrap());

/// The extracted, structured view of a single invoice. Serialised as-is into
/// `owned_item_documents.parsed_metadata` (JSONB) and returned to the SPA.
/// All fields optional — a sparse invoice still yields what it can.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParsedInvoice {
    #[serde(default)]
    pub store: Option<String>,
    #[serde(default)]
    pub invoice_number: Option<String>,
    #[serde(default)]
    pub order_number: Option<String>,
    #[serde(default)]
    pub transaction_id: Option<String>,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub invoice_date: Option<NaiveDate>,
    #[serde(default)]
    pub paid_on: Option<NaiveDate>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub amount: Option<Decimal>,
    #[serde(default)]
    pub currency: Option<String>,
    /// True when `currency` was inferred from a symbol ($, ¥ — ambiguous)
    /// rather than an explicit ISO code. The UI flags it as a guess.
    #[serde(default)]
    pub currency_guess: bool,
    /// "deposit" | "balance" | "shipping" | "other".
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub item_label: Option<String>,
}

/// Cumulative view across every parsed document on one owned item.
#[derive(Debug, Clone, Serialize)]
pub struct Rollup {
    pub parsed_count: usize,
    /// The single shared currency, when all parsed amounts agree; else `None`.
    pub currency: Option<String>,
    /// True when parsed amounts span more than one currency (cannot be summed).
    pub mixed_currency: bool,
    #[serde(with = "rust_decimal::serde::str_option")]
    pub total_paid: Option<Decimal>,
    #[serde(with = "rust_decimal::serde::str_option")]
    pub article_total: Option<Decimal>,
    #[serde(with = "rust_decimal::serde::str_option")]
    pub shipping_total: Option<Decimal>,
    /// Per-currency sums (always populated; the only breakdown when mixed).
    pub per_currency: BTreeMap<String, String>,
    pub order_numbers: Vec<String>,
    pub store: Option<String>,
    pub earliest_date: Option<NaiveDate>,
    pub latest_date: Option<NaiveDate>,
    /// True when any contributing currency was symbol-inferred.
    pub currency_guess: bool,
}

/// Parse one invoice's raw text into structured fields. Never fails — returns
/// whatever could be matched (possibly all-`None`).
pub fn parse_invoice(raw_text: &str) -> ParsedInvoice {
    let text = fix_ligatures(raw_text);
    let flat = flatten_ws(&text);
    let lower = flat.to_lowercase();

    let mut inv = ParsedInvoice {
        invoice_number: RE_INVOICE_NO
            .captures(&flat)
            .map(|c| c[1].trim().to_string())
            .or_else(|| {
                RE_INVOICE_NO_BARE
                    .captures(&flat)
                    .map(|c| c[1].trim().to_string())
            }),
        order_number: RE_ORDER_NO.captures(&flat).map(|c| c[1].to_string()),
        transaction_id: RE_TXN.captures(&flat).map(|c| c[1].to_string()),
        payment_method: RE_PAY_METHOD
            .captures(&flat)
            .map(|c| c[1].trim().to_string())
            .filter(|s| !s.is_empty() && s.len() <= 40),
        invoice_date: RE_INVOICE_DATE
            .captures(&flat)
            .and_then(|c| parse_date(&c[1])),
        paid_on: RE_PAID_ON.captures(&flat).and_then(|c| parse_date(&c[1])),
        role: classify_role(&lower).to_string(),
        ..Default::default()
    };

    // Total + currency symbol — prefer "Total Amount", else the LAST "Total"
    // (the grand total at the bottom; "Subtotal" never matches `\btotal\b`).
    let amount_caps = RE_TOTAL_AMOUNT
        .captures(&flat)
        .or_else(|| RE_TOTAL.captures_iter(&flat).last());
    let mut symbol_currency: Option<&'static str> = None;
    if let Some(c) = amount_caps {
        symbol_currency = c.get(1).and_then(|m| symbol_to_currency(m.as_str()));
        inv.amount = parse_amount(&c[2]);
    }

    // Currency: an explicit ISO code wins; else the symbol (flagged as a guess).
    if let Some(iso) = RE_ISO_CUR.captures(&flat).map(|c| c[1].to_uppercase()) {
        inv.currency = Some(if iso == "RMB" { "CNY".into() } else { iso });
        inv.currency_guess = false;
    } else if let Some(sym) = symbol_currency {
        inv.currency = Some(sym.to_string());
        inv.currency_guess = true;
    }

    // Store: "From: <x>" on the line-structured text, else the "<x> Invoice"
    // title line.
    inv.store = RE_FROM
        .captures(&text)
        .map(|c| c[1].trim().to_string())
        .or_else(|| RE_TITLE.captures(&text).map(|c| c[1].trim().to_string()))
        .filter(|s| !s.is_empty() && s.len() <= 80);

    // Item label: the first line carrying a 【…】 tag (common on GK / proxy
    // invoices), for the user to recognise which line was read.
    // Either bracket — OCR sometimes misreads the opening 【 as "[" but keeps
    // the closing 】, so match on either half of the tag.
    inv.item_label = text
        .lines()
        .map(str::trim)
        .find(|l| l.contains('【') || l.contains('】'))
        .map(|l| l.chars().take(140).collect());

    inv
}

/// Aggregate parsed invoices attached to one item into the proposed totals.
pub fn compute_rollup(items: &[ParsedInvoice]) -> Rollup {
    let mut per_cur: BTreeMap<String, Decimal> = BTreeMap::new();
    let mut order_numbers: Vec<String> = Vec::new();
    let mut store: Option<String> = None;
    let mut earliest: Option<NaiveDate> = None;
    let mut latest: Option<NaiveDate> = None;
    let mut currency_guess = false;

    for it in items {
        if let (Some(amt), Some(cur)) = (it.amount, it.currency.as_deref()) {
            *per_cur.entry(cur.to_string()).or_default() += amt;
            currency_guess |= it.currency_guess;
        }
        if let Some(on) = it.order_number.as_deref() {
            if !on.is_empty() && !order_numbers.iter().any(|x| x == on) {
                order_numbers.push(on.to_string());
            }
        }
        if store.is_none() {
            store = it.store.clone().filter(|s| !s.is_empty());
        }
        if let Some(d) = it.paid_on.or(it.invoice_date) {
            earliest = Some(earliest.map_or(d, |e| e.min(d)));
            latest = Some(latest.map_or(d, |l| l.max(d)));
        }
    }

    let per_currency: BTreeMap<String, String> =
        per_cur.iter().map(|(k, v)| (k.clone(), v.to_string())).collect();

    // A single shared currency → we can sum and split articles vs shipping.
    let (currency, total_paid, article_total, shipping_total, mixed) = if per_cur.len() == 1 {
        let (cur, total) = per_cur.iter().next().unwrap();
        let mut article = Decimal::ZERO;
        let mut shipping = Decimal::ZERO;
        for it in items {
            match (it.amount, it.currency.as_deref()) {
                (Some(amt), Some(c)) if c == cur.as_str() => {
                    if it.role == "shipping" {
                        shipping += amt;
                    } else {
                        article += amt;
                    }
                }
                _ => {}
            }
        }
        (
            Some(cur.clone()),
            Some(*total),
            Some(article),
            Some(shipping),
            false,
        )
    } else {
        (None, None, None, None, per_cur.len() > 1)
    };

    Rollup {
        parsed_count: items.len(),
        currency,
        mixed_currency: mixed,
        total_paid,
        article_total,
        shipping_total,
        per_currency,
        order_numbers,
        store,
        earliest_date: earliest,
        latest_date: latest,
        currency_guess,
    }
}

// --- helpers -----------------------------------------------------------------

/// Classify an invoice's role within a multi-invoice purchase. Shipping is
/// checked first because a freight invoice often repeats the original item
/// line ("…, Deposit | Qty: 1") in its description.
fn classify_role(lower: &str) -> &'static str {
    if lower.contains("freight")
        || lower.contains("shipping channel")
        || lower.contains("shipping:")
        || lower.contains("shipping fee")
        || lower.contains("livraison")
    {
        "shipping"
    } else if lower.contains("deposit") || lower.contains("acompte") {
        "deposit"
    } else if lower.contains("balance")
        || lower.contains("blance") // ORZGK's recurring typo for "Balance"
        || lower.contains("final payment")
        || lower.contains("remaining")
        || lower.contains("solde")
    {
        "balance"
    } else {
        "other"
    }
}

/// Replace the common Latin ligatures pdf-extract leaves behind (e.g. "ﬁ" →
/// "fi"). Cosmetic, but keeps words/emails readable and searchable.
fn fix_ligatures(s: &str) -> String {
    s.replace('\u{FB00}', "ff")
        .replace('\u{FB01}', "fi")
        .replace('\u{FB02}', "fl")
        .replace('\u{FB03}', "ffi")
        .replace('\u{FB04}', "ffl")
}

/// Collapse every run of whitespace (incl. the newlines pdf-extract inserts
/// mid-label, e.g. "Invoice\nNumber") to single spaces, so label-anchored
/// regexes match across the original line breaks.
fn flatten_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Tolerant money parse: "$168.00", "1,234.56", "1.234,56", "50" → Decimal.
/// Best-effort — ambiguous grouping (e.g. a lone "1.234") resolves to the
/// dot-decimal reading most invoices use.
fn parse_amount(raw: &str) -> Option<Decimal> {
    let s: String = raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .trim_start_matches(['$', '€', '£', '¥'])
        .to_string();
    if s.is_empty() {
        return None;
    }
    let (has_dot, has_comma) = (s.contains('.'), s.contains(','));
    let normalized = if has_dot && has_comma {
        // Rightmost separator is the decimal point; the other is grouping.
        if s.rfind('.') > s.rfind(',') {
            s.replace(',', "")
        } else {
            s.replace('.', "").replace(',', ".")
        }
    } else if has_comma {
        // "50,00" → decimal; "1,234" (grouping) → strip.
        let parts: Vec<&str> = s.split(',').collect();
        if parts.len() == 2 && parts[1].len() <= 2 {
            s.replace(',', ".")
        } else {
            s.replace(',', "")
        }
    } else {
        s
    };
    Decimal::from_str(&normalized).ok()
}

fn parse_date(raw: &str) -> Option<NaiveDate> {
    let s = raw.trim();
    ["%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"]
        .into_iter()
        .find_map(|fmt| NaiveDate::parse_from_str(s, fmt).ok())
}

fn symbol_to_currency(sym: &str) -> Option<&'static str> {
    match sym {
        "$" => Some("USD"),
        "€" => Some("EUR"),
        "£" => Some("GBP"),
        "¥" => Some("JPY"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed reproductions of the two real ORZGK sample invoices, as the
    // pdf-extract spike produced them (label/value pairs, 【…】 tags).
    const ORZGK_DEPOSIT: &str = "ORZGK Invoice\nFrom: ORZGK\nEmail: services@orzgk.com\n\
        Invoice Number INV-67701961\nInvoice Status Paid\nInvoice Date 2026-03-17\n\
        Paid On 2026-03-18\nPayment Method PayPal Standard\n\
        Transaction ID 54U33093YN773562J\nTotal Amount $168.00\n\
        【Blance】Spider Studio - Broken Miku Hatsune Miku - Version B, Deposit $168.00 1 $168.00\n\
        Subtotal $168.00\nTotal $168.00\n";

    const ORZGK_FREIGHT: &str = "ORZGK Invoice\nFrom: ORZGK\nEmail: services@orzgk.com\n\
        Invoice Number INV-67736593\nInvoice Status Paid\nInvoice Date 2026-03-31\n\
        Paid On 2026-03-31\nPayment Method PayPal Standard\n\
        Transaction ID 9K234119L1331502K\nTotal Amount $50.00\n\
        【Freight】Shipping: By Sea.1(Tax-Free)\n\
        Order: 67419180 | Spider Studio - Broken Miku Hatsune Miku - Version B, Deposit | Qty: 1\n\
        Subtotal $50.00\nTotal $50.00\n";

    fn dec(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn parses_freight_invoice() {
        let p = parse_invoice(ORZGK_FREIGHT);
        assert_eq!(p.invoice_number.as_deref(), Some("INV-67736593"));
        assert_eq!(p.order_number.as_deref(), Some("67419180"));
        assert_eq!(p.transaction_id.as_deref(), Some("9K234119L1331502K"));
        assert_eq!(p.payment_method.as_deref(), Some("PayPal Standard"));
        assert_eq!(p.amount, Some(dec("50.00")));
        assert_eq!(p.currency.as_deref(), Some("USD"));
        assert!(p.currency_guess);
        assert_eq!(p.role, "shipping");
        assert_eq!(p.invoice_date, NaiveDate::from_ymd_opt(2026, 3, 31));
        assert_eq!(p.store.as_deref(), Some("ORZGK"));
    }

    #[test]
    fn deposit_role_and_amount() {
        let p = parse_invoice(ORZGK_DEPOSIT);
        assert_eq!(p.role, "deposit");
        assert_eq!(p.amount, Some(dec("168.00")));
        assert_eq!(p.order_number, None); // deposit invoice carries no Order:
    }

    #[test]
    fn rollup_splits_articles_and_shipping() {
        let r = compute_rollup(&[parse_invoice(ORZGK_DEPOSIT), parse_invoice(ORZGK_FREIGHT)]);
        assert!(!r.mixed_currency);
        assert_eq!(r.currency.as_deref(), Some("USD"));
        assert_eq!(r.total_paid, Some(dec("218.00")));
        assert_eq!(r.article_total, Some(dec("168.00")));
        assert_eq!(r.shipping_total, Some(dec("50.00")));
        assert_eq!(r.order_numbers, vec!["67419180".to_string()]);
        assert_eq!(r.store.as_deref(), Some("ORZGK"));
        assert_eq!(r.earliest_date, NaiveDate::from_ymd_opt(2026, 3, 18));
    }

    #[test]
    fn mixed_currency_is_flagged_not_summed() {
        let mut a = parse_invoice(ORZGK_DEPOSIT);
        a.currency = Some("EUR".into());
        let b = parse_invoice(ORZGK_FREIGHT); // USD
        let r = compute_rollup(&[a, b]);
        assert!(r.mixed_currency);
        assert_eq!(r.total_paid, None);
        assert_eq!(r.per_currency.len(), 2);
    }

    #[test]
    fn amount_parser_handles_separators() {
        assert_eq!(parse_amount("$1,234.56"), Some(dec("1234.56")));
        assert_eq!(parse_amount("1.234,56"), Some(dec("1234.56")));
        assert_eq!(parse_amount("50"), Some(dec("50")));
        assert_eq!(parse_amount("€53.28"), Some(dec("53.28")));
    }

    #[test]
    fn ocr_reordering_fallbacks() {
        // Simulates OCR output: the "Invoice Number" label is split from its
        // value, the grand total floats around, and 【 was misread as "[".
        let t = "ORZGK Invoice From: ORZGK\n\
                 Invoice INV-67736593 Number\n\
                 [Freight】 Shipping: By Sea.1\n\
                 Order: 67419180\n\
                 Total $50.00";
        let p = parse_invoice(t);
        assert_eq!(p.invoice_number.as_deref(), Some("INV-67736593")); // bare fallback
        assert_eq!(p.amount, Some(dec("50.00")));
        assert_eq!(p.currency.as_deref(), Some("USD"));
        assert_eq!(p.role, "shipping");
        assert_eq!(p.order_number.as_deref(), Some("67419180"));
        assert!(p.item_label.as_deref().unwrap_or("").contains("Freight")); // 】 tolerance
    }
}
