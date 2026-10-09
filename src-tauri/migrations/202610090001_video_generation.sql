PRAGMA foreign_keys = ON;

-- G-P1/G-P2c/G-P3：视频生成（多模态网关的 video 渠道）
-- 会话 / 消息 / 资产与 imagegen 同构；额外有异步任务表（提交 → 轮询 → 回调）。

CREATE TABLE IF NOT EXISTS videogen_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videogen_sessions_recent
  ON videogen_sessions(archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS videogen_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES videogen_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  prompt TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  model TEXT,
  upstream_model TEXT,
  member_id TEXT,
  task_id TEXT,
  error_message TEXT,
  video_count INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videogen_messages_session
  ON videogen_messages(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS videogen_assets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES videogen_sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES videogen_messages(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videogen_assets_message
  ON videogen_assets(message_id, created_at ASC);

-- 异步任务：对外 task_id（new-api 契约）→ 上游 task_id；轮询推进 status；可选 callback_url 投递。
CREATE TABLE IF NOT EXISTS videogen_tasks (
  task_id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES videogen_sessions(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES videogen_messages(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  upstream_model TEXT,
  dialect TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  upstream_task_id TEXT,
  url TEXT,
  error_message TEXT,
  callback_url TEXT,
  callback_delivered INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videogen_tasks_status
  ON videogen_tasks(status, created_at ASC);
