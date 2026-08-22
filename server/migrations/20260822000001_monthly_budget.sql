-- Monthly pre-order budget ceiling (QW8 — cashflow plan).
--
-- Pre-orders fail on *cashflow*, not on the annual total: four orders placed
-- months apart can all settle in the same month, and the deposit already paid
-- makes walking away expensive. The projection itself is derived from data we
-- already store (price, deposit, release_date_current, balance_paid_at) — the
-- only thing missing was the line the user wants to stay under.
--
-- Nullable: no ceiling is a legitimate state, and must not be confused with a
-- ceiling of zero. Currency is stored alongside so the line means the same
-- thing whatever display currency is active later.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS monthly_budget_amount   NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS monthly_budget_currency CHAR(3);
