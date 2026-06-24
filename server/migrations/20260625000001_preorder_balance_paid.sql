-- Pre-orders: record WHEN the buyer paid the remaining balance.
--
-- The acompte (`deposit_amount`) covers only part of `price_amount`; the rest
-- is billed later — often weeks BEFORE shipment, since makers collect the
-- balance at the pre-shipping stage. Until now "fully paid" could only be
-- inferred from status = shipped/received, so a balance settled while the
-- figurine was still in production kept showing a phantom "solde restant".
--
-- This nullable date is the explicit signal: NON-NULL ⇒ the balance is paid
-- (value = the day it was paid); NULL ⇒ still owed.
ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS balance_paid_at DATE;
