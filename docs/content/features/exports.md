# Data export

Your data is yours. The **Archives** drawer at the bottom of your settings page
(蔵) exports your collection, wishlist and pre-orders, and bundles everything into
a single backup file.

## What you can export

| Dataset | CSV (spreadsheet) | JSON (faithful backup) |
|---|---|---|
| Collection | Name · type · manufacturer · scale · condition · paid · currency · estimated value · purchase date · JAN | the same fields |
| Wishlist | Name · manufacturer · target price · current MSRP · note | the same fields |
| Pre-orders | Name · store · status · original date · current date · slips · deposit · currency | the same fields |

A **Full backup** button produces one JSON file bundling collection + wishlist +
pre-orders + profile, with an `app` / `version` / `exported_at` header — ready to
re-import or migrate.

## How it works

Each download is a plain authenticated link: your session cookie rides along and
the server replies with `Content-Disposition: attachment`, so nothing leaves the
server without your click. The endpoints are
`GET /api/me/export/{collection,wishlist,preorders}.{csv,json}` and
`/api/me/export/backup.json`.

!!! note "Moved into settings"
    Data export used to live on a standalone `/archives` page; as of v0.13.0 it's
    the last drawer of the settings page. The download links are unchanged.
