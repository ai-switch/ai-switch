# 旧账号池收敛启动修复 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在本会话逐任务实施，按 test-driven-development 验证先失败再修复。步骤用复选框跟踪。

**Goal:** 修复 v0.18.0 删除仍被引用的旧分组导致无法启动的问题，保持账号与账务数据无损。

**Architecture:** 复用现有 `converge_legacy_pool_groups(pool: &SqlitePool) -> Result<(), AppError>` 的事务、成员搬迁与删除语句。补齐六张引用表的保护集合并逐表检查存在性。现有升级回归复用真实 SQL 和 checksum ledger。

**Tech Stack:** Rust、SQLx 0.8、SQLite、Tokio tests；Python 标准库仅用于只读备份和副本数据摘要。

**Spec:** `docs/superpowers/specs/2026-11-13-legacy-pool-convergence-startup-design.md`

## Global Constraints

- 不修改已发布 SQL、不关闭外键、不删除账号或历史、不重写价格与账务归属。
- 真实数据库仅以只读连接备份；验证只在隔离副本进行。
- 保持 main，无分支或 worktree；其它会话的文件不纳入修改。
- Cargo 仅使用 src-tauri/target-codex。
- 本阶段不提交推送、不覆盖安装、不修改真实库。

## Review Focus

- 仅模型/同步表引用旧组，不得被密钥或设置 fixture 遮蔽。
- 历史与计费预留引用的旧组必须保留；必要 key 父记录指向 codex，避免遮蔽。
- SaaS 表不存在或只有其中一张存在，不得查询不存在的表。
- SQL 已提交但收敛未完成的再次启动必须成功且幂等。
- out/archived 成员不能因收敛被启用；无引用组仍按原规则迁移。

---

### Task 1: 回归测试与完整引用保护

**Files:**
- Modify: `src-tauri/src/database/migration_unified_pool_tests.rs`
- Modify: `src-tauri/src/database/repositories/route_pool_repository.rs:228-257`

**Interfaces:** 消费现有 `run_migrations_until`、`apply_remaining_migrations`、`migrate_legacy_pool_views`；保持 `converge_legacy_pool_groups` 的签名不变。

- [x] 新增模型/同步独立引用旧组的回归，使用真实 SaaS schema；断言旧组、其成员与引用行原样保留。
- [x] 运行 `CARGO_TARGET_DIR=target-codex cargo test --lib database::migration_unified_pool_tests`，确认旧实现报 `database.legacy_pool_converge`/外键787。
- [x] 收集现存六表的 DISTINCT group_id，去重并复用原有保护条件；逐表存在性检查兼容部分 schema。
- [x] 补密钥、设置、模型、同步、预留、用量六表独立引用，以及无 SaaS/部分表/空 SaaS schema 回归。
- [x] 覆盖真实旧版升级与 SQL 已提交的重启入口，两次运行并断言账号/价格/账务快照一致、`PRAGMA foreign_key_check` 无结果。
- [x] 运行迁移回归及完整 `cargo test`，确认全绿；不自动提交。

### Task 2: 本机数据库副本验证

**Files:** 同测试文件增加明确忽略、只能使用临时目录副本的诊断测试；临时备份和检查脚本不进入仓库。

**Interfaces:** 使用 `database::open_migrated_pool(database_file, backups_dir)` 的生产入口，环境参数仅接受系统临时目录内固定命名的副本。

- [x] 只读连接本机库，SQLite backup 至新的隔离目录，包含 WAL 的已提交数据。
- [x] 生成账号、模型、同步、预留、用量与账务摘要，不输出密钥或账号内容。
- [x] 在副本上运行生产入口两次；确认84账号保留、所有非收敛表摘要相同、外键完整、三个被引用Claude组保留。
- [x] 检查仅预期源文件和本文档修改；说明恢复本机或发布补丁需要后续确认。

## 完成验证与后续发布

- 旧实现回归：6 个预期失败，分别复现外键 787 与部分 schema 查询不存在表。
- 修复后：迁移回归 12 通过；Rust 全量 2253 通过、0 失败；前端 1075 通过，类型检查通过。
- 已在隔离副本上执行两次生产启动迁移，84 个账号与全部模型/同步/密钥/账务记录保留；10 张表的数据摘要一致，外键检查通过。
- 一次独立代码复核完成；诊断路径限制与归档成员归属覆盖均已补齐并验证。
- 用户随后确认正式发布 v0.18.1；提交推送和 CI 发布按 AGENTS.md 执行，不修改真实数据库或自动覆盖安装目录。
