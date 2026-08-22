-- Arrival QC — condition reports and their defect log (BB7).
--
-- Unboxing is where the money is lost: a warped sword, paint transfer, a snapped
-- peg. Claim windows are short and unforgiving, and today `owned_items.condition`
-- is a single mutable string with no history — a piece that arrived damaged, was
-- refunded 30% and then repaired is indistinguishable from one that arrived mint,
-- and nothing warns that the 7-day window closes tomorrow.
--
-- A report is a dated snapshot; defects hang off it. Opening an ARRIVAL report
-- starts two countdowns (the shop's DOA window and the carrier's claim window)
-- that the daily cron watches.
--
-- Defect photos are NOT catalogue photos: they reference `owned_item_documents`,
-- which is owner-only private storage. A cracked figure must never leak into a
-- shared vitrine or a public profile.
CREATE TABLE IF NOT EXISTS condition_reports (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owned_item_id  UUID        NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
    -- Denormalised owner so every read can be scoped without a join, exactly
    -- like owned_item_documents.
    user_id        UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    kind           TEXT        NOT NULL DEFAULT 'arrival'
                   CHECK (kind IN ('arrival','periodic','post_repair')),
    reported_on    DATE        NOT NULL DEFAULT current_date,
    -- Overall verdict on the same ladder as owned_items.condition_item.
    overall_grade  CHAR(2)     CHECK (overall_grade IS NULL
                                      OR overall_grade IN ('A+','A','A-','B+','B','C','J')),
    note           TEXT,
    -- Claim countdowns. Nullable: not every arrival is worth a claim.
    doa_deadline      DATE,
    carrier_deadline  DATE,
    -- Outcome, and what it actually returned — that amount belongs in the
    -- piece's real cost, which is why it is stored with its currency.
    claim_status   TEXT        NOT NULL DEFAULT 'none'
                   CHECK (claim_status IN ('none','opened','refunded','replaced','partial','refused')),
    claim_amount   NUMERIC(12,2),
    claim_currency CHAR(3),
    claim_closed_on DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS condition_reports_item_idx
    ON condition_reports (owned_item_id, reported_on DESC);
-- The cron scans open claim windows; keep that lookup cheap.
CREATE INDEX IF NOT EXISTS condition_reports_open_windows_idx
    ON condition_reports (user_id)
    WHERE claim_status IN ('none','opened');

CREATE TABLE IF NOT EXISTS condition_defects (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID        NOT NULL REFERENCES condition_reports(id) ON DELETE CASCADE,
    zone        TEXT        NOT NULL
                CHECK (zone IN ('paint','joint','seam','base','accessory','box','other')),
    -- 1 cosmetic · 2 noticeable · 3 ruins the piece.
    severity    SMALLINT    NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
    note        TEXT,
    -- Evidence lives in PRIVATE document storage, never in figure_photos.
    document_id UUID        REFERENCES owned_item_documents(id) ON DELETE SET NULL,
    resolved_on DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS condition_defects_report_idx
    ON condition_defects (report_id, created_at);
