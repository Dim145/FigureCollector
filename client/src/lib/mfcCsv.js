// MyFigureCollection CSV import (wishlist bulk importer).
//
// MFC offers an official export — Manager → CSV Export, also available on
// lists — so the importer reads that file locally instead of scraping a
// Cloudflare-walled site. The parser is deliberately tolerant: it locates
// columns by header name (Title / ID / Barcode…) rather than position, so
// minor format drift on MFC's side doesn't break the flow.

/** Minimal RFC-4180-ish CSV reader: quoted fields, "" escapes, CRLF/LF. */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/** Parse an MFC CSV export into the importer's internal item shape. Returns
 *  `[]` when no Title column can be located (probably not an MFC export). */
export function parseMfcCsv(text) {
  const rows = parseCsvRows(String(text ?? ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const exact = (name) => headers.findIndex((h) => h === name);
  const fuzzy = (...names) =>
    headers.findIndex((h) => names.some((n) => h.includes(n)));

  const iTitle = fuzzy("title", "name");
  const iId = exact("id");
  const iJan = fuzzy("barcode", "jan");
  if (iTitle < 0) return [];

  const items = [];
  const seen = new Set();
  for (const r of rows.slice(1)) {
    const title = (r[iTitle] ?? "").trim();
    if (!title) continue;
    const id = iId >= 0 ? (r[iId] ?? "").trim().replace(/\D/g, "") : "";
    const jan = iJan >= 0 ? (r[iJan] ?? "").trim().replace(/[^0-9Xx]/g, "") : "";
    const detail_url = id
      ? `https://myfigurecollection.net/item/${id}`
      : `mfc:${title.toLowerCase()}`;
    if (seen.has(detail_url)) continue;
    seen.add(detail_url);
    items.push({
      title,
      studio: null,
      version: null,
      price: null,
      image_url: null,
      detail_url,
      jan: jan || null,
      source: "mfc",
    });
  }
  return items;
}
