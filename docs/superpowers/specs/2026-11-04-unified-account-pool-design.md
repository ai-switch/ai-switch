# 统一账号池（G-P8 P4）设计

> 2026-11-05 按用户拍板收口。取代本文档早期版本（「保留对接身份枚举 + 7 组并存」方案已废弃）。

## 统一后的最终形态

```
左侧导航（取代 7 个平台入口）        账号池（唯一）
 ├ 通用   ← 官方订阅 + API 都在这    ├ kind             official / api
 ├ 图片                              ├ provider         official: openai/claude/gemini/grok…
 ├ 视频                              │                 api: custom/openrouter/packycode/agentrouter
 ├ 音频                              ├ interface_format 协议族（不变）
 └ 向量   ← 预留位                   └ capabilities     模态能力（不变）
```

- 一个账号池；左侧每个入口只是它的**分模态管理视图**（现 codex 页分段器升级为全应用主页）。
- **官方账号只出现在「通用」**；图片/视频/音频段全是 API 账号（Seedance 等「官方渠道」也归 API 类型）。
- **一把 key 访问所有模态**（本地 `sk-ai-switch-codex`，值不变；SaaS `sk-saas-` key 同样取消平台限制）。
- 组只剩一套视图分组：默认组（=参与服务）/ 未入池 / 已归档；**入池语义保留**（本地候选仍从默认组加载）。
- 智能体对接（给 Codex CLI / Claude Code 写配置、启动）收进「通用」页的接入信息。

## 用户拍板（2026-11-05）

1. API provider 预设：`custom + openrouter + 国内中转（packycode / agentrouter）`。
2. SaaS 取消平台端点限制：一个 key 全模态；现有组/key 继续用。
3. 智能体对接收进通用页。
4. **只留一把 key**：老 `sk-ai-switch-<platform>` key 迁移时废弃（客户端需改配 codex key）；SaaS key 不受影响。

## 数据迁移（`202611040002_unified_account_pool.sql`，append-only）

1. `route_credentials` 加 `provider TEXT NOT NULL DEFAULT ''`：
   - official 回填：`codex→openai`，其余按原 platform（claude/gemini/grok/…）；
   - api 回填：`config_json.base_url` 匹配内置预设（openrouter.ai→openrouter、packycode→packycode、agentrouter→agentrouter），其余 `custom`。
2. `route_credentials` / `route_pool_members` / `route_pool_groups` 的 `platform` 统一 `'codex'`。
3. 组收敛：被 SaaS（keys/订阅等）引用的组保留为销售分组（platform 变 codex，id 不变，计费列不动）；其余非 codex 组删除，成员按原 slug（default/out/archived）并入 codex 对应视图组。
4. `route_proxy_keys` / `route_proxy_key_aliases` 删除非 codex 行（只留 codex 主 key，值不变）。
5. 放开「一平台一 active 组」唯一索引（改普通索引）：SaaS 销售分组可与默认组并存 active。
6. `route_pool_cursors` 只留 codex。

## 代码收尾（P4a Task 2）

- `resolve_platform`：key 只认 codex 行；候选加载恒 codex 池、默认组成员参与服务（行为不变）。
- SaaS：删除 `principal.platform` 的端点白名单（`saas/proxy/mod.rs` claude→anthropic、gemini→images 限制）；组平台查询随迁移自然匹配 `'codex'`。
- official 账号相关消费点（默认 base_url、deeplink、模型目录）从 platform 改读 `provider`。

## 明确不做（本切片）

- 不删 `PlatformId` 枚举（客户端生态/写配置适配器仍在用）；P4b 前端删导航后再收敛。
- 不合并 SaaS 组、不动计费列；不实现向量模态（仅导航预留）。

## 验收

迁移后：codex 主 key 原值可用且能命中原 claude/gemini 池账号；老 key 401；SaaS 组 key 认证计费不变且可打全模态；官方账号 provider 正确；全量 Rust（桌面 + standalone）、前端、打包、sidecar 回归通过。
