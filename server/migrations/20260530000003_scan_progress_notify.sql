-- Live scan updates (Lot 3).
--
-- The gsplat worker writes the `scans` row DIRECTLY (asyncpg), so the server
-- never sees the ready/failed/progress transition through an HTTP handler and
-- can't push it to the SPA. A NOTIFY trigger bridges that: any state /
-- result_key / progress change fires `pg_notify('scan_changed', …)`, which a
-- server LISTEN task forwards to the user's WebSocket. Works for the worker's
-- existing direct-DB writes — no worker changes needed.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS progress SMALLINT;

CREATE OR REPLACE FUNCTION fc_notify_scan_changed() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'scan_changed',
        json_build_object('scan_id', NEW.id, 'owned_item_id', NEW.owned_item_id)::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scans_notify ON scans;
CREATE TRIGGER scans_notify
    AFTER UPDATE ON scans
    FOR EACH ROW
    WHEN (
        OLD.state IS DISTINCT FROM NEW.state
        OR OLD.result_key IS DISTINCT FROM NEW.result_key
        OR OLD.progress IS DISTINCT FROM NEW.progress
    )
    EXECUTE FUNCTION fc_notify_scan_changed();
