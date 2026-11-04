PRAGMA foreign_keys = ON;

-- G-P8 P4a：统一账号池。
-- 池身份（route_* 表的 platform 列）统一为 'codex'；provider 落列承载
-- 官方厂商 / API 来源；只留一把本地 key。
-- **组删除与成员迁移不在这里做**：判断「组是否被 SaaS 引用」需要查 SaaS 表，
-- 而 SaaS 表由独立的 SaaS 迁移链创建、可能在核心迁移执行时尚不存在（全新库）。
-- 它们由启动收敛步骤（RoutePoolRepository::converge_legacy_pool_groups）完成，
-- 该步骤与本迁移同批执行（见 run_migrations 的既有 legacy 视图收敛先例）。

-- 1) provider 落列。official 的订阅类型原本住在 platform 列，统一后无处派生；
--    api 按既有 base_url 识别内置预设，识别不出的一律 custom（诚实默认值）。
ALTER TABLE route_credentials ADD COLUMN provider TEXT NOT NULL DEFAULT '';
UPDATE route_credentials SET provider = CASE
  WHEN kind = 'official' THEN CASE platform WHEN 'codex' THEN 'openai' ELSE platform END
  WHEN config_json LIKE '%openrouter.ai%' THEN 'openrouter'
  WHEN config_json LIKE '%packycode%' THEN 'packycode'
  WHEN config_json LIKE '%agentrouter%' THEN 'agentrouter'
  ELSE 'custom'
END;

-- 2) 先放开「一平台一 active 组」唯一索引：7 个平台的 active 组即将并入同一池，
--    索引必须在统一 platform 之前 drop，否则迁移本身就撞唯一约束。
--    大池子下组只是分区（视图分组 + SaaS 销售分组），不再是身份。
DROP INDEX IF EXISTS idx_route_pool_groups_one_active;

-- 3) 组级智能体归属（回填必须在统一 platform **之前**，原平台就是归属）：
--    SaaS 模型同步等逻辑需要知道这个销售分组面向哪个智能体生态。
ALTER TABLE route_pool_groups ADD COLUMN agent TEXT NOT NULL DEFAULT '';
UPDATE route_pool_groups SET agent = platform;

-- 4) 池身份统一。
UPDATE route_credentials SET platform = 'codex';
UPDATE route_pool_members SET platform = 'codex';
UPDATE route_pool_groups SET platform = 'codex';

-- 5) 旧平台组标记：组收敛（删无 SaaS 引用的组、迁移其成员）由启动收敛步骤按
--    此标记执行；收敛后标记清零。
ALTER TABLE route_pool_groups ADD COLUMN legacy_group INTEGER NOT NULL DEFAULT 0;
UPDATE route_pool_groups SET legacy_group = 1 WHERE id NOT LIKE 'codex-%';
UPDATE route_pool_groups SET legacy_group = 0 WHERE id LIKE 'codex-%';

-- 6) serves_local：本地服务的成员资格标记。默认组与 SaaS 销售分组参与服务；
--    未入池 / 已归档不参与。统一后「参与服务的启用账号」= serves_local 组的并集。
ALTER TABLE route_pool_groups ADD COLUMN serves_local INTEGER NOT NULL DEFAULT 0;
UPDATE route_pool_groups SET serves_local = CASE
  WHEN id LIKE '%-out' OR id LIKE '%-archived' THEN 0
  ELSE 1
END;

CREATE INDEX IF NOT EXISTS idx_route_pool_groups_platform_active
  ON route_pool_groups(platform, is_active);

-- 7) 只留一把本地 key（codex 主 key 值不变，客户端改配一次）；游标只留 codex。
DELETE FROM route_proxy_keys WHERE platform != 'codex';
DELETE FROM route_proxy_key_aliases WHERE platform != 'codex';
DELETE FROM route_pool_cursors WHERE platform != 'codex';
