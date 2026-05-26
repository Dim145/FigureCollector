# Pre-orders

The pre-order page (`/preorders`) — *the Horarium* — is the chronological ledger of acquisitions to come. Each entry threads a single gold spine and stamps the figure with a circular kanji seal indicating its lifecycle phase.

## Lifecycle states

| Status | Kanji | Meaning |
|---|---|---|
| `announced` | 報 | The figurine was announced but pre-orders aren't open yet |
| `preorder_open` | 受 | Pre-orders are open — you can still order |
| `preordered` | 予 | You've placed the order |
| `in_production` | 作 | Manufacturer is producing it |
| `released` | 出 | The figurine has been released in stores |
| `shipped` | 送 | Your specific copy has shipped |
| `received` | 着 | You have it in hand |
| `cancelled` | 中 | Cancelled (by you, the shop, or upstream) |

Cancellation is **not terminal** — see [Cancellations](#cancellations) below.

---

## Deposit (acompte)

OrzGK, AmiAmi, Tsuki Hobby, and most Japanese shops split a pre-order into:

- a **deposit** paid upfront at order time (e.g. 30 € on a 200 € figurine)
- a **balance** paid before shipping (170 € here)

FigureCollector records the deposit on the `preorders` row as `deposit_amount`. It's:

- **Editable** on both `/preorders` (in the preorder edit form) and the figure detail page (when the linked owned item exists).
- **Inherited currency** — same as `price_currency`, no separate field. A deposit in a different currency than the balance would make the % vs catalogue comparison nonsensical.
- **Part of `price_amount`, not in addition** — meaning: `deposit + balance = price`. The total paid stays `price + shipping`.

### Price popup

When a deposit is set, the popup on `Prix payé` switches from:

```
DÉTAIL DU PRIX
FIGURINE    242,37 EUR
LIVRAISON   90 EUR
TOTAL PAYÉ  332,37 EUR
CATALOGUE   242,37 EUR
```

to:

```
DÉTAIL DU PRIX
DÉPÔT       30 EUR
FIGURINE    212,37 EUR    ← (242,37 - 30, the balance)
LIVRAISON   90 EUR
TOTAL PAYÉ  332,37 EUR    ← unchanged
CATALOGUE   242,37 EUR
```

The catalogue-delta calculation includes the deposit (it's part of the figurine cost) but excludes shipping (a carrier charge).

---

## Delivery ETA & countdown

When a preorder transitions to `shipped`, the backend auto-stamps `shipped_at = NOW()`. The user then records the **estimated delivery in days** (`estimated_delivery_days`) — the ETA quoted by the carrier.

The projected delivery date is computed on the fly:

```
delivery_date = shipped_at::date + estimated_delivery_days
```

Both inputs can change independently — no materialised column.

### Countdown chip

The preorder card + the figure-detail history both show a countdown:

| Days remaining | Label | Tone |
|---:|---|---|
| > 0 | `J-3` (or `D-3` in English) | Or pâle (pale gold) |
| 0 | `J0` | Or saturé (saturated gold) |
| < 0 | `J+2` (overdue by 2 days) | Laque-red |

The implementation lives in `client/src/lib/deliveryCountdown.js` and uses UTC-day comparison so a midnight crossover doesn't add a spurious ±1 to the result.

### Notifications

The daily cron job (`release_cron.run_once`) extends to also fire:

- `preorder_delivery_today` — once per `(preorder_id, delivery_date)` when the projected date equals today.
- `preorder_delivery_overdue` — once per `preorder_id` on J+1 (the day after the ETA) when the piece isn't marked `received`.

Both dispatch through the same channel-routing system as the existing release-date events. See [Notifications](notifications.md).

---

## Cancellations

A pre-order can be cancelled by either party — bankruptcy, recall, the user changing their mind, the shop refusing the import. The cancellation is **not terminal**: you can restore the item later and optionally pair it with a fresh preorder.

### The flow

When you click the "× Annuler la pré-cmde" button (on the figure detail page) or the cancellation chip (on `/preorders`), a two-step dialog opens:

1. **Refund amount.** How much (if anything) was refunded? Three quick options:
    - **Perdu** — refund = 0, total loss (typical user-initiated cancellation)
    - **Entièrement remboursé** — refund = deposit, no loss (typical shop-initiated cancellation)
    - **Manual entry** — for partial refunds (rare but real, e.g. minus bank fees)

2. **Fate of the owned item** — only shown when the refund covers the full deposit. Pick:
    - **Supprimer** — delete the owned_item (cascades the preorder)
    - **Archiver** — keep the row but mark `archived_at`, hide from default views

   When the refund is partial (< deposit), step 2 is **skipped** and the owned_item is **auto-archived** so the loss record survives.

### Storage

The preorder row gets:

- `status = 'cancelled'`
- `deposit_refund_amount` = whatever the user entered (NULL when the dialog wasn't used, e.g. legacy data)

The owned_item gets:

- `archived_at = NOW()` when archived

### Restoring an archived item

The figure detail page on an archived owned_item shows a laque-red banner explaining the state and a **↺ Restaurer** button. Clicking it clears `archived_at` and the item rejoins the active collection.

The linked preorder keeps `status = 'cancelled'` — restore is decoupled from un-cancel because the user often restores in order to pair with a *fresh* preorder (new shop, new release date). They can then edit the preorder status manually from `/preorders`.

### Price popup when cancelled

When the preorder is cancelled, the popup switches to "loss" mode:

```
DÉTAIL DU PRIX
ACOMPTE PERDU    30 EUR     ← laque-red
TOTAL PAYÉ       30 EUR
CATALOGUE       242,37 EUR
```

The shipping line disappears (no shipment happened), the figurine balance disappears (was never paid), and the delta-vs-catalogue isn't computed (the user never received a comparable price).

If the refund equals or exceeds the deposit, the popup hides the ACOMPTE PERDU line entirely (no loss to display).

---

## Slip history

Each `release_date_current` change creates a `preorder_date_history` row with the previous date, the new date, the source (`user`, `mfc`, `anilist`), and an optional user note. The figure detail page renders this as a timeline.

The yearly recap surfaces the **longest slip** as a separate stat card.
