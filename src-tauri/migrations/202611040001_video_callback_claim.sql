-- 回调尝试计数不是互斥锁；租约让并发 poll/refresh 只允许一个投递者。
ALTER TABLE videogen_tasks ADD COLUMN callback_claim_token TEXT;
ALTER TABLE videogen_tasks ADD COLUMN callback_claim_until TEXT;
