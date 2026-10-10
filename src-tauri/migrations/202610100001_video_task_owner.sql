-- 视频任务的两次补强（G-P4 复审）
--
-- 1. `owner_user_id` —— SaaS 任务必须能回答「这个 task_id 属于谁」。
--    没有它，`GET /v1/video/generations/{task_id}` 在 SaaS 侧只能二选一：
--    要么整条不可用（复审前的状态：`saas::proxy::execute` 用
--    `method != Method::POST` 把所有查询都拒了），要么任何 `sk-saas-` key
--    都能读到别人的任务和出片地址。两者都不可接受。
--    直连网关（本地 token / route proxy key）的任务没有用户概念，留 NULL。
--
-- 2. `callback_attempts` —— 回调投递失败要能重试，但不能无限重试。
--    复审前的状态更糟：`list_active_tasks` 只取 `status='processing'`，
--    而终态任务的 `poll_once` 会直接早返回，所以 `callback_delivered=0` 的
--    任务**永远不会被重投**——`deliver_callback` 上那句「失败留给下一轮重投」
--    是假的。这里给它一个可计数的预算，超了就不再重试。
ALTER TABLE videogen_tasks ADD COLUMN owner_user_id TEXT;
ALTER TABLE videogen_tasks ADD COLUMN callback_attempts INTEGER NOT NULL DEFAULT 0;
