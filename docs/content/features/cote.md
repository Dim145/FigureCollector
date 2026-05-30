# La Cote (collection value)

`/cote` is the **value dashboard** — what your collection is worth today versus
what you paid for it.

## Effective value

Each piece's value is resolved, in order:

1. a **manual value** you set (`value_amount` — the *cote*), else
2. the figure's catalogue **MSRP** as a fallback, else
3. nothing (the piece isn't counted).

!!! note "No currency conversion"
    Values are aggregated **per currency** — there is no FX overlay. A JPY piece
    and a EUR piece are summed in their own buckets; the dashboard leads with the
    dominant bucket and lists the others as footnotes. This keeps the numbers
    honest rather than inventing an exchange rate.

## What it shows

- **Valeur estimée** — the dominant currency's effective-value sum, in large type.
- **Total payé** — what you actually paid (`price_amount + shipping_amount`).
- **Plus-value** — estimated − paid, with a % badge: jade for a gain, laque-red
  for a loss.
- **Pièces évaluées X / Y** — how many pieces carry a real value vs fall back to
  MSRP.
- A **ranked table** of every valued piece (highest first); each row shows paid
  vs estimated vs the per-piece delta.

## Editing a value

Click a row to set or clear its manual value inline (a currency-prefixed input; a
"reset to MSRP" button clears the override). Saving (`PUT /me/owned/{id}/value`)
refreshes the table and the dashboard totals immediately.

The same effective-value logic powers the per-cabinet totals on
[Vitrines](vitrines.md) and the opt-in value on your public
[collector profile](social.md).
