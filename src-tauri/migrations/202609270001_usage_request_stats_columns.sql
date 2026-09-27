-- The account list aggregates read `success` and `duration_ms` out of
-- `metadata_json` with `json_extract` on every joined row. That same document
-- also carries the (compressed) response-body preview, so each probe has to
-- parse a large JSON blob just to pull two scalars — and `usage_events` is
-- never pruned, so the list only ever gets slower as history grows.
--
-- Promote both to real columns, backfill them from the JSON that already holds
-- them, and add an index so the list's per-account seek + newest-first walk no
-- longer table-scans. The `metadata_json` copies stay untouched: other readers
-- still consume them, and keeping both means this migration is purely additive.
ALTER TABLE usage_events ADD COLUMN success INTEGER;
ALTER TABLE usage_events ADD COLUMN duration_ms INTEGER;

-- Backfill preserves the list's existing semantics exactly. `json_extract`
-- yields 1/0 for a present JSON boolean and NULL for a legacy row that never
-- wrote the key, and the aggregates already treat that NULL as "not a success"
-- (`SUM(CASE WHEN ... = 1 ...)`) — so a NULL here reproduces the old count.
-- The `LIKE` guard keeps the rewrite off rows that never carried either key.
UPDATE usage_events
   SET success = json_extract(metadata_json, '$.success'),
       duration_ms = json_extract(metadata_json, '$.duration_ms')
 WHERE metadata_json LIKE '%"success"%'
    OR metadata_json LIKE '%"duration_ms"%';

-- The account list seeks by account, filters by source_label + metric_type, and
-- either counts the group or walks it newest-first for the latency tags. This
-- index carries all four columns so the hot path seeks and scans in order
-- instead of scanning the whole table; the two scalars it needs are now plain
-- columns, so the row fetch no longer drags the large metadata_json along.
CREATE INDEX IF NOT EXISTS idx_usage_events_request_stats
  ON usage_events (route_credential_id, source_label, metric_type, created_at);
