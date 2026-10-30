-- Per-platform baseline model aliases used when a route account has no explicit mapping.
-- The route proxy only has a SqlitePool while serving /v1/models, so this belongs in
-- the database rather than settings.json.
CREATE TABLE IF NOT EXISTS route_pool_baseline_models (
  platform TEXT PRIMARY KEY,
  models_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
