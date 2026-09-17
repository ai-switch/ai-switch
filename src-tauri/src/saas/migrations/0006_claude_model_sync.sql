ALTER TABLE saas_group_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1));
ALTER TABLE saas_group_models ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE saas_group_models ADD COLUMN managed_by_pool INTEGER NOT NULL DEFAULT 0 CHECK(managed_by_pool IN (0,1));
ALTER TABLE saas_group_models ADD COLUMN last_seen_at INTEGER;
ALTER TABLE saas_group_models ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE saas_group_models SET updated_at=CAST(strftime('%s','now') AS INTEGER) WHERE updated_at=0;
CREATE INDEX saas_group_models_public_state
    ON saas_group_models(group_id, sync_state, enabled, model);
CREATE TABLE saas_group_model_sync (
    group_id TEXT PRIMARY KEY REFERENCES route_pool_groups(id),
    source_fingerprint TEXT NOT NULL,
    last_success_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL
);
