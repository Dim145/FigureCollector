//! Insurance dossier — merge each owned item's proof-of-purchase documents
//! (invoice PDFs + scanned image receipts) into ONE PDF, behind a per-figurine
//! section-separator page.
//!
//! `lopdf` merges the existing invoice PDFs and decrypts empty-password store
//! invoices (pure-Rust crypto, no OpenSSL); `printpdf` builds the separator
//! pages and wraps image receipts (jpg/png/webp) as A4 PDF pages. Everything is
//! in-memory — no temp files, so it runs under the read-only FROM-scratch
//! container. All functions here are synchronous + CPU-bound: call them from
//! `tokio::task::spawn_blocking`.
//!
//! Separator pages embed a Unicode font (Go fonts, BSD-3, in assets/fonts/) so
//! accents render and long titles wrap to fit; printpdf subsets it to the used
//! glyphs. Glyphs the font lacks (e.g. CJK) fall back to .notdef.

use lopdf::{Document, Object, ObjectId};
use printpdf::*;
use std::collections::BTreeMap;

const MM_TO_PT: f32 = 2.834_645_7;
const A4_W_PT: f32 = 210.0 * MM_TO_PT;
const A4_H_PT: f32 = 297.0 * MM_TO_PT;

/// One attached document, fetched from storage.
pub struct DocPart {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub filename: String,
}

/// One figurine's section in the dossier: a separator page then its documents.
pub struct Section {
    pub title: String,
    pub subtitle: String,
    pub docs: Vec<DocPart>,
}

/// True when this MIME is a PDF (merge its pages) rather than an image (wrap it).
fn is_pdf(mime: &str) -> bool {
    let m = mime.split(';').next().unwrap_or("").trim();
    m.eq_ignore_ascii_case("application/pdf")
}

/// The bundled UI font (Go fonts, BSD-3 — assets/fonts/). Embedded so the
/// separator pages render real UTF-8 (accents é · …) and we can measure glyph
/// widths to wrap long titles. printpdf subsets to the glyphs actually used, so
/// the output PDF stays small despite the ~150 KB source files.
const FONT_REGULAR: &[u8] = include_bytes!("../../assets/fonts/Go-Regular.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../../assets/fonts/Go-Bold.ttf");

/// Separator text-column margins → usable width for wrapping.
const SEP_MARGIN_MM: f32 = 22.0;
const SEP_MAX_W_PT: f32 = (210.0 - 2.0 * SEP_MARGIN_MM) * MM_TO_PT;

/// Parse the bundled fonts (cheap allsorts parse). Panics only if the embedded
/// TTFs are corrupt — a build-time invariant.
fn parse_fonts() -> (ParsedFont, ParsedFont) {
    let regular = ParsedFont::from_bytes(FONT_REGULAR, 0, &mut Vec::new())
        .expect("bundled Go-Regular.ttf must parse");
    let bold = ParsedFont::from_bytes(FONT_BOLD, 0, &mut Vec::new())
        .expect("bundled Go-Bold.ttf must parse");
    (regular, bold)
}

/// Width of `s` at `size_pt`, in points, from the font's glyph advances.
fn text_width_pt(font: &ParsedFont, s: &str, size_pt: f32) -> f32 {
    let upm = font.font_metrics.units_per_em.max(1) as f32;
    let units: u32 = s
        .chars()
        .map(|c| font.get_horizontal_advance(font.lookup_glyph_index(c as u32).unwrap_or(0)) as u32)
        .sum();
    (units as f32 / upm) * size_pt
}

/// Greedy word-wrap to fit `max_w_pt`. Never truncates — the full text is shown
/// across as many lines as needed (a lone over-long word keeps its own line).
fn wrap(font: &ParsedFont, text: &str, size_pt: f32, max_w_pt: f32) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        let trial = if cur.is_empty() {
            word.to_string()
        } else {
            format!("{cur} {word}")
        };
        if cur.is_empty() || text_width_pt(font, &trial, size_pt) <= max_w_pt {
            cur = trial;
        } else {
            lines.push(std::mem::take(&mut cur));
            cur = word.to_string();
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/// One-page A4 separator: a gold kicker, a bold title (wrapped so it always
/// shows in full), an optional grey subtitle. Renders real UTF-8 via the
/// embedded fonts.
pub fn separator_page(
    regular: &ParsedFont,
    bold: &ParsedFont,
    kicker: &str,
    title: &str,
    subtitle: &str,
) -> Vec<u8> {
    let mut doc = PdfDocument::new("Section");
    let id_reg = doc.add_font(regular);
    let id_bold = doc.add_font(bold);

    let mut ops = vec![
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(Mm(SEP_MARGIN_MM), Mm(212.0)),
        },
        // gold kicker (Direction-A --color-or)
        Op::SetFont {
            font: PdfFontHandle::External(id_reg.clone()),
            size: Pt(10.0),
        },
        Op::SetFillColor {
            col: Color::Rgb(Rgb { r: 0.66, g: 0.52, b: 0.20, icc_profile: None }),
        },
        Op::ShowText {
            items: vec![TextItem::Text(kicker.trim().to_string())],
        },
    ];

    // Title — bold, wrapped across as many lines as needed (no truncation).
    for (i, line) in wrap(bold, title.trim(), 16.0, SEP_MAX_W_PT).iter().enumerate() {
        ops.push(Op::SetLineHeight { lh: Pt(if i == 0 { 28.0 } else { 20.0 }) });
        ops.push(Op::AddLineBreak);
        if i == 0 {
            ops.push(Op::SetFont {
                font: PdfFontHandle::External(id_bold.clone()),
                size: Pt(16.0),
            });
            ops.push(Op::SetFillColor {
                col: Color::Rgb(Rgb { r: 0.12, g: 0.11, b: 0.10, icc_profile: None }),
            });
        }
        ops.push(Op::ShowText {
            items: vec![TextItem::Text(line.clone())],
        });
    }

    // Subtitle — grey, smaller, also wrapped.
    let sub = subtitle.trim();
    if !sub.is_empty() {
        for (i, line) in wrap(regular, sub, 10.5, SEP_MAX_W_PT).iter().enumerate() {
            ops.push(Op::SetLineHeight { lh: Pt(if i == 0 { 22.0 } else { 15.0 }) });
            ops.push(Op::AddLineBreak);
            if i == 0 {
                ops.push(Op::SetFont {
                    font: PdfFontHandle::External(id_reg.clone()),
                    size: Pt(10.5),
                });
                ops.push(Op::SetFillColor {
                    col: Color::Rgb(Rgb { r: 0.42, g: 0.40, b: 0.38, icc_profile: None }),
                });
            }
            ops.push(Op::ShowText {
                items: vec![TextItem::Text(line.clone())],
            });
        }
    }

    ops.push(Op::EndTextSection);
    let page = PdfPage::new(Mm(210.0), Mm(297.0), ops);
    doc.with_pages(vec![page])
        .save(&PdfSaveOptions::default(), &mut Vec::new())
}

/// Wrap a decoded image (jpg/png/webp bytes) as a single A4 page, scaled to fit
/// within margins (never upscaled), centred. Errors on an undecodable image.
fn image_page(image_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut doc = PdfDocument::new("Receipt");
    let image = RawImage::decode_from_bytes(image_bytes, &mut Vec::new())?;
    let img_w = image.width as f32;
    let img_h = image.height as f32;
    if img_w <= 0.0 || img_h <= 0.0 {
        return Err("empty image".into());
    }
    let image_id = doc.add_image(&image);

    let margin_pt = 36.0; // ~0.5in
    let avail_w = A4_W_PT - 2.0 * margin_pt;
    let avail_h = A4_H_PT - 2.0 * margin_pt;
    // dpi:None ⇒ 1px renders as 1pt, so fit by points.
    let scale = (avail_w / img_w).min(avail_h / img_h).min(1.0);
    let draw_w = img_w * scale;
    let draw_h = img_h * scale;
    let tx = (A4_W_PT - draw_w) / 2.0;
    let ty = (A4_H_PT - draw_h) / 2.0;

    let ops = vec![Op::UseXobject {
        id: image_id,
        transform: XObjectTransform {
            translate_x: Some(Pt(tx)),
            translate_y: Some(Pt(ty)),
            rotate: None,
            scale_x: Some(scale),
            scale_y: Some(scale),
            dpi: None,
        },
    }];
    let page = PdfPage::new(Mm(210.0), Mm(297.0), ops);
    Ok(doc
        .with_pages(vec![page])
        .save(&PdfSaveOptions::default(), &mut Vec::new()))
}

/// Load an in-memory PDF, attempting empty-password decryption. Returns the
/// `Document` ready to merge, or an error for a corrupt / truly password-locked
/// file (the caller then substitutes a placeholder page).
fn load_pdf(bytes: &[u8]) -> Result<Document, String> {
    let mut doc = Document::load_mem(bytes).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        doc.decrypt("").map_err(|e| format!("encrypted: {e}"))?;
    }
    Ok(doc)
}

/// Assemble the final dossier: the cover, then for each section a separator page
/// followed by its documents — PDF pages merged, images wrapped, and any
/// unreadable file replaced by a note page so the dossier never silently drops
/// a document. Pure + CPU-bound → run under `spawn_blocking`.
pub fn build(
    cover: &[u8],
    sections: Vec<Section>,
    kicker: &str,
    unreadable_label: &str,
) -> Result<Vec<u8>, String> {
    let (regular, bold) = parse_fonts();
    let mut parts: Vec<Document> = Vec::new();
    // Cover first — it's our own jsPDF output; a load failure is fatal.
    parts.push(load_pdf(cover).map_err(|e| format!("cover: {e}"))?);

    for sec in sections {
        if let Ok(d) = load_pdf(&separator_page(&regular, &bold, kicker, &sec.title, &sec.subtitle)) {
            parts.push(d);
        }
        for doc in sec.docs {
            let part = if is_pdf(&doc.mime) {
                load_pdf(&doc.bytes).map(|mut d| {
                    drop_near_empty_pages(&mut d);
                    d
                })
            } else {
                image_page(&doc.bytes).and_then(|b| load_pdf(&b))
            };
            match part {
                Ok(d) => parts.push(d),
                Err(_) => {
                    let note = format!("{unreadable_label} : {}", doc.filename);
                    if let Ok(d) = load_pdf(&separator_page(&regular, &bold, kicker, &note, "")) {
                        parts.push(d);
                    }
                }
            }
        }
    }

    merge_documents(parts)
}

/// The four attributes a `/Page` may inherit from an ancestor `/Pages` node
/// (PDF 32000-1, Table 30). Re-parenting during merge orphans any page that
/// relied on inheritance, so we copy each value down onto the page itself first.
const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// Walk a page's `/Parent` chain and return the first owned value for `key`,
/// dereferencing one level if it's a reference. Cycle-guarded.
fn resolve_inherited(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut current = page_id;
    let mut seen: Vec<ObjectId> = Vec::new();
    loop {
        if seen.contains(&current) {
            return None; // /Parent cycle — bail rather than loop forever
        }
        seen.push(current);
        let dict = doc.get_object(current).ok()?.as_dict().ok()?;
        if let Ok(value) = dict.get(key) {
            return match value.as_reference() {
                Ok(ref_id) => doc.get_object(ref_id).ok().map(Object::to_owned),
                Err(_) => Some(value.to_owned()),
            };
        }
        match dict.get(b"Parent").ok().and_then(|p| p.as_reference().ok()) {
            Some(parent_id) => current = parent_id,
            None => return None,
        }
    }
}

/// For every page, copy any inheritable attribute it doesn't already own down
/// from its `/Parent` chain onto the page dict, making it self-contained. Run on
/// each source doc BEFORE renumber/merge — afterwards the original `/Pages`
/// ancestry (which held the inherited `/Resources`) is gone. Without this,
/// web-printed invoices (wkhtmltopdf/dompdf/Chrome) that keep `/Resources` on
/// the parent node render BLANK after re-parenting.
fn flatten_inherited_page_attributes(doc: &mut Document) {
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        let owned: [bool; 4] = {
            let Ok(dict) = doc.get_object(page_id).and_then(Object::as_dict) else {
                continue;
            };
            [
                dict.has(INHERITABLE[0]),
                dict.has(INHERITABLE[1]),
                dict.has(INHERITABLE[2]),
                dict.has(INHERITABLE[3]),
            ]
        };
        let mut to_set: Vec<(&[u8], Object)> = Vec::new();
        for (i, key) in INHERITABLE.iter().enumerate() {
            if owned[i] {
                continue;
            }
            if let Some(value) = resolve_inherited(doc, page_id, key) {
                to_set.push((key, value));
            }
        }
        if to_set.is_empty() {
            continue;
        }
        if let Ok(dict) = doc.get_object_mut(page_id).and_then(Object::as_dict_mut) {
            for (key, value) in to_set {
                dict.set(key.to_vec(), value);
            }
        }
    }
}

/// True if the page references any XObject (image or form) in its resolved
/// resources — such a page is never treated as "near-empty".
fn page_has_xobject(doc: &Document, page_id: ObjectId) -> bool {
    matches!(
        resolve_inherited(doc, page_id, b"Resources"),
        Some(Object::Dictionary(ref d)) if d.has(b"XObject")
    )
}

/// Drop near-empty pages from an invoice — the trailing continuation pages many
/// web-printed invoices carry (just the print header/footer; e.g. ORZGK's page 2
/// ≈ 1 KB of content vs ≈ 14 KB for a real page). Dropped only if the decoded
/// content is tiny AND the page has no XObject, so scanned-image pages are always
/// kept. Never drops the only page, nor every page.
fn drop_near_empty_pages(doc: &mut Document) {
    const MIN_CONTENT_BYTES: usize = 2000;
    let pages = doc.get_pages();
    if pages.len() <= 1 {
        return;
    }
    let mut drop: Vec<u32> = Vec::new();
    for (&num, &pid) in &pages {
        let len = doc.get_page_content(pid).map(|c| c.len()).unwrap_or(usize::MAX);
        if len < MIN_CONTENT_BYTES && !page_has_xobject(doc, pid) {
            drop.push(num);
        }
    }
    if drop.is_empty() || drop.len() >= pages.len() {
        return;
    }
    tracing::debug!(pages = ?drop, "dossier: dropping near-empty invoice continuation pages");
    doc.delete_pages(&drop);
}

/// Merge already-loaded PDF `Document`s into one, preserving every page in the
/// given order. Adapted from lopdf's `examples/merge.rs` (bookmark/outline
/// handling dropped — we want a flat page sequence).
fn merge_documents(docs: Vec<Document>) -> Result<Vec<u8>, String> {
    let mut max_id = 1u32;
    let mut pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();

    for mut doc in docs {
        // Flatten inherited page attributes BEFORE re-parenting — otherwise a
        // page that inherited /Resources from its original /Pages node loses its
        // fonts and renders blank in the merged output.
        flatten_inherited_page_attributes(&mut doc);
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for id in doc.get_pages().into_values() {
            if let Ok(obj) = doc.get_object(id) {
                pages.insert(id, obj.to_owned());
            }
        }
        objects.extend(doc.objects);
    }

    let mut out = Document::with_version("1.5");
    let mut catalog: Option<(ObjectId, Object)> = None;
    let mut pages_node: Option<(ObjectId, Object)> = None;

    for (id, object) in objects {
        match object.type_name().unwrap_or(b"") {
            b"Catalog" => {
                let cid = catalog.as_ref().map(|(i, _)| *i).unwrap_or(id);
                catalog = Some((cid, object));
            }
            b"Pages" => {
                if let Ok(d) = object.as_dict() {
                    let mut d = d.clone();
                    if let Some((_, ref old)) = pages_node {
                        if let Ok(od) = old.as_dict() {
                            d.extend(od);
                        }
                    }
                    let pid = pages_node.as_ref().map(|(i, _)| *i).unwrap_or(id);
                    pages_node = Some((pid, Object::Dictionary(d)));
                }
            }
            // Pages are re-parented + inserted below; outlines are dropped.
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                out.objects.insert(id, object);
            }
        }
    }

    let (pages_id, pages_obj) = pages_node.ok_or("merged PDF has no Pages node")?;
    let (catalog_id, catalog_obj) = catalog.ok_or("merged PDF has no Catalog")?;

    // Re-parent every page onto the merged Pages node.
    for (id, object) in &pages {
        if let Ok(d) = object.as_dict() {
            let mut d = d.clone();
            d.set("Parent", pages_id);
            out.objects.insert(*id, Object::Dictionary(d));
        }
    }

    // Rebuild the Pages node: Count + Kids.
    if let Ok(d) = pages_obj.as_dict() {
        let mut d = d.clone();
        d.set("Count", pages.len() as u32);
        d.set(
            "Kids",
            pages.into_keys().map(Object::Reference).collect::<Vec<_>>(),
        );
        out.objects.insert(pages_id, Object::Dictionary(d));
    }

    // Point the catalog at the merged Pages node.
    if let Ok(d) = catalog_obj.as_dict() {
        let mut d = d.clone();
        d.set("Pages", pages_id);
        out.objects.insert(catalog_id, Object::Dictionary(d));
    }

    out.trailer.set("Root", catalog_id);
    out.max_id = out.objects.len() as u32;
    out.renumber_objects();
    out.compress();

    let mut buf = Vec::new();
    out.save_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny 2×2 PNG, encoded via the `image` crate (which printpdf also uses).
    /// Leading `::image` dodges the `printpdf::image` module pulled in by the
    /// `use printpdf::*` glob above.
    fn tiny_png() -> Vec<u8> {
        let img = ::image::RgbImage::from_fn(2, 2, |x, _| {
            if x == 0 {
                ::image::Rgb([200, 40, 40])
            } else {
                ::image::Rgb([40, 40, 200])
            }
        });
        let mut buf = std::io::Cursor::new(Vec::new());
        ::image::DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, ::image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    fn page_count(pdf: &[u8]) -> usize {
        Document::load_mem(pdf).unwrap().get_pages().len()
    }

    /// A PDF whose single page has NO /Resources or /MediaBox of its own — both
    /// are INHERITED from the parent /Pages node (the exact shape that made the
    /// ORZGK invoices render blank after a naive merge). The content stream
    /// draws text with the inherited font /F1.
    fn make_inheriting_pdf() -> Vec<u8> {
        use lopdf::{Stream, dictionary};
        let mut doc = Document::with_version("1.5");
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 24 Tf 72 700 Td (INHERIT-TEST-BODY) Tj ET".to_vec(),
        ));
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            // deliberately NO /Resources, NO /MediaBox — inherited below
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog", "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    #[test]
    fn separator_is_a_valid_one_page_pdf() {
        let (reg, bold) = parse_fonts();
        let pdf = separator_page(&reg, &bold, "JUSTIFICATIFS", "Hatsune Miku — GSC", "ORZGK · 2 justificatifs");
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(page_count(&pdf), 1);
    }

    #[test]
    fn image_wraps_to_one_page() {
        let pdf = image_page(&tiny_png()).expect("a PNG should wrap to a page");
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(page_count(&pdf), 1);
    }

    #[test]
    fn build_merges_cover_separator_and_each_document() {
        // Generated single-page PDFs stand in for the jsPDF cover + an invoice.
        let (reg, bold) = parse_fonts();
        let cover = separator_page(&reg, &bold, "", "Cover", "");
        let invoice_pdf = separator_page(&reg, &bold, "", "Fake invoice", "");
        let section = Section {
            title: "Hatsune Miku".into(),
            subtitle: "ORZGK".into(),
            docs: vec![
                DocPart {
                    mime: "application/pdf".into(),
                    bytes: invoice_pdf,
                    filename: "inv.pdf".into(),
                },
                DocPart {
                    mime: "image/png".into(),
                    bytes: tiny_png(),
                    filename: "receipt.png".into(),
                },
            ],
        };
        let out = build(&cover, vec![section], "JUSTIFICATIFS", "Illisible").expect("build ok");
        assert!(out.starts_with(b"%PDF-"));
        // cover + separator + invoice page + image page = 4 pages
        assert_eq!(page_count(&out), 4);
    }

    #[test]
    fn unreadable_document_becomes_a_note_page_not_a_failure() {
        let (reg, bold) = parse_fonts();
        let cover = separator_page(&reg, &bold, "", "Cover", "");
        let section = Section {
            title: "Broken".into(),
            subtitle: String::new(),
            docs: vec![DocPart {
                mime: "application/pdf".into(),
                bytes: b"this is not a pdf".to_vec(),
                filename: "bad.pdf".into(),
            }],
        };
        let out = build(&cover, vec![section], "JUSTIFICATIFS", "Illisible").expect("build ok");
        assert!(out.starts_with(b"%PDF-"));
        // cover + separator + placeholder note (the bad doc is replaced) = 3 pages
        assert_eq!(page_count(&out), 3);
    }

    #[test]
    fn inheriting_page_survives_merge() {
        let pdf = make_inheriting_pdf();
        // The fixture page must INHERIT /Resources (not own it) — that's the case
        // a naive merge breaks.
        let pre = Document::load_mem(&pdf).unwrap();
        let pid = pre.get_pages().into_values().next().unwrap();
        assert!(
            !pre.get_object(pid).unwrap().as_dict().unwrap().has(b"Resources"),
            "fixture should inherit /Resources, not own it"
        );
        // After merge (which flattens), the page MUST own /Resources — otherwise
        // its font is undefined and the body renders blank.
        let merged = merge_documents(vec![load_pdf(&pdf).unwrap()]).unwrap();
        let chk = Document::load_mem(&merged).unwrap();
        let mpid = chk.get_pages().into_values().next().unwrap();
        assert!(
            chk.get_object(mpid).unwrap().as_dict().unwrap().has(b"Resources"),
            "merged page lost its inherited /Resources → would render blank"
        );
        let txt = pdf_extract::extract_text_from_mem(&merged).unwrap_or_default();
        assert!(txt.contains("INHERIT-TEST-BODY"), "merged text missing: {txt:?}");
    }

    /// A 2-page PDF: page 1 carries substantial content, page 2 is near-empty
    /// (a print header only, no XObject) — the web-invoice continuation shape.
    fn make_two_page_pdf() -> Vec<u8> {
        use lopdf::{Stream, dictionary};
        let mut doc = Document::with_version("1.5");
        let font = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let mut big = String::from("BT /F1 10 Tf 72 760 Td ");
        for i in 0..150 {
            big.push_str(&format!("(real invoice content line {i}) Tj 0 -12 Td "));
        }
        big.push_str("ET");
        let c1 = doc.add_object(Stream::new(dictionary! {}, big.into_bytes()));
        let c2 = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 8 Tf 72 760 Td (#INV-123 - 2 sur 2) Tj ET".to_vec(),
        ));
        let pages_id = doc.new_object_id();
        let page = |content| {
            dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => content,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            }
        };
        let p1 = doc.add_object(page(c1));
        let p2 = doc.add_object(page(c2));
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![p1.into(), p2.into()],
                "Count" => 2,
            }),
        );
        let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", cat);
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    #[test]
    fn drops_near_empty_continuation_page() {
        let mut doc = load_pdf(&make_two_page_pdf()).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
        drop_near_empty_pages(&mut doc);
        assert_eq!(doc.get_pages().len(), 1, "the near-empty page 2 must be dropped");
    }
}
