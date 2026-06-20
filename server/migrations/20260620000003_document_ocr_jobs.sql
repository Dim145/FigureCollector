-- OCR job queue for image / scanned-PDF justificatifs (Palier 2).
--
-- Text-layer PDFs are parsed in-process (Palier 1). Documents WITHOUT a text
-- layer (photos, scans, image-only PDFs) are queued here; the GPU worker
-- (gsplat-worker, RapidOCR) claims a row, OCRs the blob, and writes back
-- `result_text`. A trigger fires `pg_notify('ocr_changed', …)` so the server's
-- ocr_listener can parse the text with the SAME `parse_invoice` heuristics and
-- store the suggestion as `owned_item_documents.parsed_metadata`.
--
-- Mirrors the scans/embedding-queue conventions (FOR UPDATE SKIP LOCKED claim,
-- worker_id ownership, attempts counter, state machine). Idempotent.
CREATE TABLE IF NOT EXISTS document_ocr_jobs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    UUID        NOT NULL REFERENCES owned_item_documents(id) ON DELETE CASCADE,
    owned_item_id  UUID        NOT NULL REFERENCES owned_items(id)          ON DELETE CASCADE,
    user_id        UUID        NOT NULL REFERENCES users(id)                ON DELETE CASCADE,
    storage_key    TEXT        NOT NULL,
    mime           TEXT        NOT NULL,
    state          TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending', 'processing', 'ready', 'failed')),
    result_text    TEXT,
    error_message  TEXT,
    worker_id      UUID        REFERENCES workers(id) ON DELETE SET NULL,
    attempts       INTEGER     NOT NULL DEFAULT 0,
    claimed_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim index: oldest pending first.
CREATE INDEX IF NOT EXISTS document_ocr_jobs_pending_idx
    ON document_ocr_jobs (created_at)
    WHERE state = 'pending';

-- At most one in-flight job per document (lets the enqueue be idempotent: a
-- second "Extraire" click while one is queued/running is a no-op).
CREATE UNIQUE INDEX IF NOT EXISTS document_ocr_jobs_one_active_idx
    ON document_ocr_jobs (document_id)
    WHERE state IN ('pending', 'processing');

-- NOTIFY bridge → server ocr_listener (mirror of scans_notify).
CREATE OR REPLACE FUNCTION fc_notify_ocr_changed()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'ocr_changed',
        json_build_object(
            'job_id', NEW.id,
            'document_id', NEW.document_id,
            'owned_item_id', NEW.owned_item_id,
            'state', NEW.state
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_ocr_jobs_notify ON document_ocr_jobs;
CREATE TRIGGER document_ocr_jobs_notify
    AFTER UPDATE ON document_ocr_jobs
    FOR EACH ROW
    WHEN (OLD.state IS DISTINCT FROM NEW.state)
    EXECUTE FUNCTION fc_notify_ocr_changed();
