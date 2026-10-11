PRAGMA foreign_keys = ON;

-- OpenAI 原生视频契约（`/v1/videos`）的对象体里带 `seconds` 与 `size`，
-- 两个都是**字符串**（`"4"` / `"1280x720"`）。这两个值在提交时就已经知道
-- （`protocol::effective_duration_seconds` / `protocol::effective_size`），
-- 但任务表原先没有地方放它们，于是 `GET /v1/videos/{video_id}` 只能回 null。
--
-- 纯追加：既有行留 NULL，`/v1/video/generations` 那条契约完全不读这两列，
-- 所以对已上线的 new-api 契约零影响。
ALTER TABLE videogen_tasks ADD COLUMN duration_seconds INTEGER;
ALTER TABLE videogen_tasks ADD COLUMN size TEXT;
