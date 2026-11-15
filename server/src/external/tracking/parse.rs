//! Server-side twin of `client/src/lib/carrierTracking.js`.
//!
//! A preorder stores whatever the user pasted in `tracking_url`: a carrier
//! link, or (since the Parcels fallback) a bare tracking number. The SPA
//! parses it to pick the carrier; the delivered-parcel watcher needs the same
//! answer without a browser, so the carrier table is mirrored here.
//!
//! Keep the two in lockstep: same ids, same hosts, same query parameters,
//! same bare-number rules. Only `id` / `hosts` / `params` matter server-side —
//! display names and canonical links stay in the SPA.

use reqwest::Url;

/// Carrier id for a number we can't attribute — Parcels auto-detects it.
pub const AUTO: &str = "auto";

/// Every carrier id the tracking proxy accepts (the SPA's `CARRIERS` ids plus
/// [`AUTO`]). Guards the `/tracking/{carrier}/…` path so arbitrary strings
/// never reach a cache key or an upstream call.
pub fn is_known_carrier(id: &str) -> bool {
    carrier_ids().any(|c| c == id)
}

/// Every accepted carrier id, [`AUTO`] last.
pub fn carrier_ids() -> impl Iterator<Item = &'static str> {
    CARRIERS.iter().map(|c| c.id).chain(std::iter::once(AUTO))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTracking {
    pub carrier: &'static str,
    pub number: String,
}

struct Carrier {
    id: &'static str,
    hosts: &'static [&'static str],
    params: &'static [&'static str],
}

const CARRIERS: &[Carrier] = &[
    Carrier {
        id: "ups",
        hosts: &["ups.com", "wwwapps.ups.com"],
        params: &["tracknum", "InquiryNumber1", "trackingNumber", "trackingnumber"],
    },
    Carrier {
        id: "dhl",
        hosts: &["dhl.com", "dhl.de", "mydhl.express.dhl"],
        params: &["tracking-id", "trackingNumber", "AWB", "tracking_id"],
    },
    Carrier {
        id: "colissimo",
        hosts: &["laposte.fr", "colissimo.fr"],
        params: &["code"],
    },
    Carrier {
        id: "chronopost",
        hosts: &["chronopost.fr"],
        params: &["listeNumerosLT", "code"],
    },
    Carrier {
        id: "fedex",
        hosts: &["fedex.com"],
        params: &["tracknumbers", "trackingnumber", "trackingNumber"],
    },
    Carrier {
        id: "usps",
        hosts: &["usps.com", "tools.usps.com"],
        params: &["tLabels", "qtc_tLabels1", "labels"],
    },
    Carrier {
        id: "mondialrelay",
        hosts: &["mondialrelay.fr", "mondialrelay.com"],
        params: &["numeroExpedition", "NumeroExpedition"],
    },
    Carrier {
        id: "gls",
        hosts: &["gls-group.com", "gls-group.eu", "gls-group.net"],
        params: &["match", "trackId"],
    },
    Carrier {
        id: "tnt",
        hosts: &["tnt.com"],
        params: &["cons", "consignmentNumber"],
    },
    Carrier {
        id: "japanpost",
        hosts: &["post.japanpost.jp", "trackings.post.japanpost.jp"],
        params: &["reqCodeNo1", "requestNo1"],
    },
    Carrier {
        id: "ems",
        hosts: &["ems.com.cn", "ems.post"],
        params: &["mailNum", "mailNo"],
    },
    Carrier {
        id: "yamato",
        hosts: &["kuronekoyamato.co.jp", "track.kuronekoyamato.co.jp"],
        params: &["number01", "tracking_no"],
    },
    Carrier {
        id: "sagawa",
        hosts: &["sagawa-exp.co.jp", "k2k.sagawa-exp.co.jp"],
        params: &["okurijoNo"],
    },
    Carrier {
        id: "hermes",
        hosts: &["myhermes.co.uk", "evri.com"],
        params: &["trackingNumber"],
    },
    Carrier {
        id: "dpd",
        hosts: &["dpd.com", "dpd.co.uk", "dpd.fr", "dpd.de"],
        params: &["parcelNumber", "trackid"],
    },
    Carrier {
        id: "amazon",
        hosts: &[
            "amazon.com",
            "amazon.fr",
            "amazon.co.uk",
            "amazon.de",
            "amazon.co.jp",
        ],
        params: &["trackingId", "orderID"],
    },
];

/// Parse a stored `tracking_url` into `(carrier, number)`. `None` when the
/// input is empty, unparseable, an unknown host, or a known host with no
/// number we can find — none of which can be tracked live.
pub fn parse(input: &str) -> Option<ParsedTracking> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(number) = bare_number(raw) {
        return Some(ParsedTracking {
            carrier: guess_carrier(&number),
            number,
        });
    }

    let lower = raw.to_ascii_lowercase();
    let has_scheme = lower.starts_with("http://") || lower.starts_with("https://");
    let url = if has_scheme {
        Url::parse(raw).ok()?
    } else {
        Url::parse(&format!("https://{raw}")).ok()?
    };
    let host = url.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);

    let carrier = CARRIERS.iter().find(|c| {
        c.hosts
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
    })?;

    for p in carrier.params {
        if let Some((_, v)) = url.query_pairs().find(|(k, _)| k == p) {
            let v = v.trim();
            if !v.is_empty() {
                return Some(ParsedTracking {
                    carrier: carrier.id,
                    number: v.to_string(),
                });
            }
        }
    }

    // Some carriers keep the number in the path (DPD /tracking/{n}, Amazon
    // /tracking/{id}) — same "last segment, ≥ 8 alphanumeric/hyphen chars"
    // heuristic as the SPA.
    let last = url.path_segments()?.filter(|s| !s.is_empty()).last()?;
    if last.len() >= 8 && last.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Some(ParsedTracking {
            carrier: carrier.id,
            number: last.to_string(),
        });
    }
    None
}

/// A pasted bare tracking number: no dot or slash (so not a link), 8–40
/// alphanumeric/hyphen chars once inner spaces are dropped, at least one
/// digit. Returned upper-cased (carriers treat numbers case-insensitively).
fn bare_number(raw: &str) -> Option<String> {
    if raw.contains('.') || raw.contains('/') || raw.contains(':') {
        return None;
    }
    let compact: String = raw.split_whitespace().collect();
    let ok_len = (8..=40).contains(&compact.len());
    let ok_chars = compact
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-');
    let has_digit = compact.chars().any(|c| c.is_ascii_digit());
    (ok_len && ok_chars && has_digit).then(|| compact.to_ascii_uppercase())
}

/// Attribute a bare number to a carrier when its format is unambiguous;
/// otherwise [`AUTO`] (Parcels detects it).
fn guess_carrier(n: &str) -> &'static str {
    let b = n.as_bytes();
    // UPU S10: 2 letters, 9 digits, ISO-2 origin country (EX123456789JP).
    let s10 = b.len() == 13
        && b[..2].iter().all(u8::is_ascii_alphabetic)
        && b[2..11].iter().all(u8::is_ascii_digit)
        && b[11..].iter().all(u8::is_ascii_alphabetic);
    if s10 && n.ends_with("JP") {
        return "japanpost";
    }
    if s10 && n.ends_with("FR") {
        return "colissimo";
    }
    // Colissimo domestic: digit, letter, 11 digits (6A12345678901).
    if b.len() == 13
        && b[0].is_ascii_digit()
        && b[1].is_ascii_alphabetic()
        && b[2..].iter().all(u8::is_ascii_digit)
    {
        return "colissimo";
    }
    // UPS: "1Z" + 16 alphanumerics.
    if b.len() == 18 && n.starts_with("1Z") && b[2..].iter().all(u8::is_ascii_alphanumeric) {
        return "ups";
    }
    AUTO
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(input: &str) -> Option<(&'static str, String)> {
        parse(input).map(|t| (t.carrier, t.number))
    }

    #[test]
    fn carrier_links_yield_carrier_and_number() {
        assert_eq!(
            p("https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901"),
            Some(("colissimo", "6A12345678901".into()))
        );
        assert_eq!(
            p("trackings.post.japanpost.jp/services/srv/search/?reqCodeNo1=EX123456789JP&locale=en"),
            Some(("japanpost", "EX123456789JP".into()))
        );
        // Number in the path (DPD).
        assert_eq!(
            p("https://www.dpd.com/tracking/01475251796393"),
            Some(("dpd", "01475251796393".into()))
        );
        // Subdomain of a known host.
        assert_eq!(
            p("https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number01=123456789012"),
            Some(("yamato", "123456789012".into()))
        );
    }

    #[test]
    fn unknown_host_or_missing_number_is_untrackable() {
        assert_eq!(p("https://example.com/track?code=123456789"), None);
        assert_eq!(p("https://www.ups.com/track"), None);
        assert_eq!(p(""), None);
        assert_eq!(p("   "), None);
    }

    #[test]
    fn bare_numbers_are_accepted_and_attributed() {
        assert_eq!(p("EX123456789JP"), Some(("japanpost", "EX123456789JP".into())));
        assert_eq!(p("cb123456789fr"), Some(("colissimo", "CB123456789FR".into())));
        assert_eq!(p("6A12345678901"), Some(("colissimo", "6A12345678901".into())));
        assert_eq!(
            p("1Z999AA10123456784"),
            Some(("ups", "1Z999AA10123456784".into()))
        );
        // Unknown format → Parcels auto-detection.
        assert_eq!(p("01475251796393"), Some((AUTO, "01475251796393".into())));
        // Inner spaces dropped.
        assert_eq!(p("EX 123 456 789 JP"), Some(("japanpost", "EX123456789JP".into())));
    }

    #[test]
    fn bare_number_rules_reject_non_numbers() {
        assert_eq!(bare_number("abcdefgh"), None); // no digit
        assert_eq!(bare_number("1234567"), None); // too short
        assert_eq!(bare_number("ups.com"), None); // a host
        assert_eq!(bare_number("12345678_9"), None); // bad char
    }

    #[test]
    fn known_carrier_guard() {
        assert!(is_known_carrier("auto"));
        assert!(is_known_carrier("japanpost"));
        assert!(!is_known_carrier("../../etc"));
        assert!(!is_known_carrier("unknown"));
    }
}
