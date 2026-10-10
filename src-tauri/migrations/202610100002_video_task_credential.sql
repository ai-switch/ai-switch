-- 视频任务要记住**是哪个账号提交的**。
--
-- 上游的任务按账号隔离：`GET /v1/videos/.../{task_id}` 用别的账号的 key 查会拿到
-- 404/403。平台统一成 `video`（供应商在账号的 `interface_format` 里）之后，
-- 同一个平台下会有多个供应商、每家又可能多个账号，「按平台重选一个」几乎必然
-- 选错账号，所以提交时必须把提交者记下来，轮询钉着它查。
--
-- 老行留 NULL：退回「只钉平台」的行为，与迁移前一致。
ALTER TABLE videogen_tasks ADD COLUMN credential_id TEXT;
