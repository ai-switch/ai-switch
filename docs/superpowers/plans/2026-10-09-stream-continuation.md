# 流式断流自动续写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上游流式回答中途断掉时，由网关自动再发一次「继续」请求并把结果接回同一条 response，客户端无错误、无需用户手动继续。

**Architecture:** 在流式响应路径上新增一个「续写泵」：它以现有 `observed_upstream_stream` 为基础，持有当前上游流、`StreamObserver` 采集到的续写状态、以及一个把续写流伪装成原 response 后续的 `ResponsesResumeRewriter`。上游断流且仍有预算时，泵用「原请求体 + 半截回答 + 继续指令」向池里再要一个账号，把续写流重写后继续吐给客户端，最后补一条合成的 `response.completed`。

**Tech Stack:** Rust（axum / reqwest / sqlx / tokio / serde_json）、Tauri v2、React + TypeScript + Vitest。

**Spec:** `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`

## Global Constraints

- AI 的 Rust 构建/测试一律用 `CARGO_TARGET_DIR=target-codex`，在 `src-tauri/` 下执行；不得新建其它 target 目录。
- 前端验证：`pnpm typecheck`、`pnpm test:run`（vitest）；Rust 单元/集成：`cargo test --lib <filter>`。
- 所有新增文档与注释用中文；代码标识符用英文。
- **失败计数必须保留**：续写不改变 `semantic_response_transient` 的记账规则，渠道稳定性统计不受影响。
- 设置项 `route_proxy_stream_continue_max`：默认 **10**，`0` 表示关闭续写。
- 账号切换：**聚合模式（`RoutePoolModelMode::Aggregate`）允许换账号**；精确模式只允许同账号重试。
- 续写请求必须**沿用原请求的 reasoning 配置**（spec 12.1 实测：预算被 reasoning 吃光会导致正文为空）。
- 上游**明确回了失败帧**（`detect_response_failed` 命中）时**不进入续写**，按既有 semantic failure 分支处理。
- 提交信息用中文 conventional commit，直接提交到 `main`。

---

### Task 1: 客户端接受度验证（先做，人工 spike）

**Files:**
- Create: `scripts/spike/stitched_sse_server.mjs`（一次性脚本，验证完可留作回归工具）
- Modify: `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`（在 12 节补实测结论）

**Interfaces:**
- Consumes: 无
- Produces: 一句结论（通过 / 不通过），写进 spec 12 节；不通过则本计划后续任务全部停止。

- [ ] **Step 1: 起一个只回拼接流的假上游**

```js
// scripts/spike/stitched_sse_server.mjs   (node 18+, 无依赖)
import http from "node:http";
const rid = "resp_stitch_spike";
const ev = (o) => `data: ${JSON.stringify(o)}

`;
http.createServer((req, res) => {
  if (!req.url.startsWith("/v1/responses")) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let n = 0;
  const send = (type, extra) => res.write(ev({ type, sequence_number: n++, ...extra }));
  send("response.created", { response: { id: rid, status: "in_progress", object: "response" } });
  send("response.output_item.added", { output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", status: "in_progress", content: [] } });
  send("response.output_text.delta", { output_index: 0, item_id: "msg_1", content_index: 0, delta: "第一段（断流前）。" });
  // ---- 模拟断流后网关续写：新 item，但沿用同一个 response.id 与连续序号 ----
  send("response.output_item.done", { output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "第一段（断流前）。" }] } });
  send("response.output_item.added", { output_index: 1, item: { id: "msg_2", type: "message", role: "assistant", status: "in_progress", content: [] } });
  send("response.output_text.delta", { output_index: 1, item_id: "msg_2", content_index: 0, delta: "第二段（续写内容）。" });
  send("response.output_item.done", { output_index: 1, item: { id: "msg_2", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "第二段（续写内容）。" }] } });
  send("response.completed", { response: { id: rid, status: "completed", object: "response", output: [], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } });
  res.end();
}).listen(8799, "127.0.0.1", () => console.log("stitched sse on 8799"));
```

- [ ] **Step 2: 用临时 CODEX_HOME 指向它，跑一次真实客户端**

```powershell
$tmp = "$env:TEMP\codex-stitch-spike"; New-Item -ItemType Directory -Force $tmp | Out-Null
@"
model = "gpt-6-astra"
model_provider = "spike"
[model_providers.spike]
name = "spike"
base_url = "http://127.0.0.1:8799/v1"
wire_api = "responses"
env_key = "SPIKE_KEY"
"@ | Set-Content "$tmp\config.toml" -Encoding UTF8
$env:SPIKE_KEY="dummy"; $env:CODEX_HOME=$tmp
node scripts/spike/stitched_sse_server.mjs &   # 另开一个终端跑
codex exec --skip-git-repo-check "只回复一句：你看到了什么？"
```

Expected: 客户端把两段合起来当作**一轮正常完成**的回答打印出来，没有 `stream disconnected`、
没有 `Incomplete response returned`；若报错，记录原始输出并**停止本计划**。

- [ ] **Step 3: 把结论写进 spec 12 节**

在 spec 的 12 节追加一行：`- 客户端接受度（YYYY-MM-DD）：<通过 / 不通过，附客户端版本与原始输出>`。

- [ ] **Step 4: Commit**

```bash
git add scripts/spike/stitched_sse_server.mjs docs/superpowers/specs/2026-10-09-stream-continuation-design.md
git commit -m "test(route): 验证客户端能接受拼接后的响应流"
```

---

### Task 2: StreamObserver 采集续写所需状态

**Files:**
- Modify: `src-tauri/src/services/route_proxy_stream.rs`（`StreamObserver` / `StreamOutcome`）
- Test: 同文件 `#[cfg(test)] mod` 新增用例

**Interfaces:**
- Consumes: 现有 `SseFramer`、`RouteUsageBreakdown`
- Produces:
  - `pub struct StreamContinuationState { response_id: Option<String>, last_sequence_number: u64, completed_items: Vec<String>, open_item: Option<OpenItem>, partial_text: String, text_truncated: bool }`
  - `pub struct OpenItem { id: String, kind: OpenItemKind, output_index: u64 }`
  - `pub enum OpenItemKind { Message, FunctionCall, Reasoning }`
  - `StreamObserver::continuation(&self) -> &StreamContinuationState`
  - `StreamOutcome` 新增字段 `continuation: StreamContinuationState`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn observer_collects_continuation_state() {
    let mut o = StreamObserver::new(1024, true);
    for frame in [
        r#"{"type":"response.created","sequence_number":0,"response":{"id":"resp_1"}}"#,
        r#"{"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_1","type":"message"}}"#,
        r#"{"type":"response.output_text.delta","sequence_number":2,"item_id":"msg_1","delta":"你好，"}"#,
        r#"{"type":"response.output_text.delta","sequence_number":3,"item_id":"msg_1","delta":"世界"}"#,
    ] {
        o.observe(format!("data: {frame}\n\n").as_bytes());
    }
    let c = o.continuation();
    assert_eq!(c.response_id.as_deref(), Some("resp_1"));
    assert_eq!(c.last_sequence_number, 3);
    assert_eq!(c.partial_text, "你好，世界");
    assert_eq!(c.open_item.as_ref().map(|i| i.id.as_str()), Some("msg_1"));
    assert!(c.completed_items.is_empty());
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib observer_collects_continuation_state`
Expected: 编译失败（`no method named continuation`）

- [ ] **Step 3: 最小实现**

```rust
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamContinuationState {
    pub response_id: Option<String>,
    pub last_sequence_number: u64,
    pub completed_items: Vec<String>,
    pub open_item: Option<OpenItem>,
    pub partial_text: String,
    pub text_truncated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItem { pub id: String, pub kind: OpenItemKind, pub output_index: u64 }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenItemKind { Message, FunctionCall, Reasoning }

const PARTIAL_TEXT_LIMIT: usize = 1024 * 1024; // spec 第 5 节

impl StreamObserver {
    pub fn continuation(&self) -> &StreamContinuationState { &self.continuation }
}
```

`StreamOutcome` 全仓库只有 `route_proxy_stream.rs:318` 一个构造点，加字段时同步改那一处即可。

在 `absorb_frame` 里按 `type` 分支：`response.created` 记 `response_id`；
`response.output_item.added` 记 `open_item`；`response.output_text.delta` 往 `partial_text` 追加
（超过 `PARTIAL_TEXT_LIMIT` 时置 `text_truncated = true` 并停止追加）；
`response.output_item.done` 把 id 推入 `completed_items` 并清空 `open_item`；
每条事件都更新 `last_sequence_number`（取事件自己的 `sequence_number`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib observer_collects_continuation_state`
Expected: PASS

- [ ] **Step 5: 补边界测试**

```rust
#[test]
fn observer_stops_appending_past_the_partial_text_limit() {
    let mut o = StreamObserver::new(1024, true);
    let big = "x".repeat(PARTIAL_TEXT_LIMIT + 10);
    o.observe(format!(
        "data: {{\"type\":\"response.created\",\"sequence_number\":0,\"response\":{{\"id\":\"r\"}}}}\n\n         data: {{\"type\":\"response.output_text.delta\",\"sequence_number\":1,\"item_id\":\"m\",\"delta\":\"{big}\"}}\n\n"
    ).as_bytes());
    assert!(o.continuation().text_truncated);
    assert!(o.continuation().partial_text.len() <= PARTIAL_TEXT_LIMIT);
}
```

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib observer_`
Expected: PASS（两个用例）

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/route_proxy_stream.rs
git commit -m "feat(route): StreamObserver 采集续写所需状态"
```

---

### Task 3: 续写请求构造

**Files:**
- Create: `src-tauri/src/services/route_stream_continuation.rs`
- Modify: `src-tauri/src/services/mod.rs`（挂 `pub mod route_stream_continuation;`）
- Test: `src-tauri/src/services/route_stream_continuation.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: 无
- Produces: `pub const CONTINUE_INSTRUCTION: &str`、`pub fn build_continuation_body(original_body: &[u8], partial_text: &str) -> Result<Vec<u8>, String>`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn appends_partial_answer_and_instruction_without_touching_other_fields() {
    let original = br#"{"model":"gpt-6-astra","store":false,"reasoning":{"effort":"high"},
        "tools":[{"type":"function","name":"t"}],"input":[{"type":"message","role":"user",
        "content":[{"type":"input_text","text":"hi"}]}]}"#;
    let out = build_continuation_body(original, "半截回答").expect("body");
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(v["model"], "gpt-6-astra");
    assert_eq!(v["reasoning"]["effort"], "high");
    assert_eq!(v["tools"][0]["name"], "t");
    let input = v["input"].as_array().unwrap();
    assert_eq!(input.len(), 3);
    assert_eq!(input[1]["role"], "assistant");
    assert_eq!(input[1]["content"][0]["text"], "半截回答");
    assert_eq!(input[2]["role"], "user");
    assert!(input[2]["content"][0]["text"].as_str().unwrap().contains("Continue exactly"));
}

#[test]
fn rejects_a_body_whose_input_is_not_an_array() {
    assert!(build_continuation_body(br#"{"model":"m","input":"hi"}"#, "x").is_err());
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib appends_partial_answer`
Expected: 编译失败（模块不存在）

- [ ] **Step 3: 实现**

```rust
use serde_json::{json, Value};

/// spec 第 6 节：与「用户手动继续」等价的那句指令。
pub const CONTINUE_INSTRUCTION: &str = "Continue exactly where the previous assistant message stopped. Do not repeat anything already written, do not add a preamble, and do not restate the question.";

pub fn build_continuation_body(original_body: &[u8], partial_text: &str) -> Result<Vec<u8>, String> {
    let mut value: Value = serde_json::from_slice(original_body)
        .map_err(|error| format!("original request body is not JSON: {error}"))?;
    let object = value.as_object_mut().ok_or("original request body must be a JSON object")?;
    let input = object.get_mut("input").ok_or("original request body has no input")?;
    let items = input.as_array_mut().ok_or("original request input must be an array")?;
    items.push(json!({"type":"message","role":"assistant",
        "content":[{"type":"output_text","text": partial_text}]}));
    items.push(json!({"type":"message","role":"user",
        "content":[{"type":"input_text","text": CONTINUE_INSTRUCTION}]}));
    object.insert("stream".to_string(), Value::Bool(true));
    serde_json::to_vec(&value).map_err(|error| format!("could not serialize continuation body: {error}"))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib route_stream_continuation`
Expected: PASS（2 个用例）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/route_stream_continuation.rs src-tauri/src/services/mod.rs
git commit -m "feat(route): 续写请求体构造"
```

---

### Task 4: ResponsesResumeRewriter（事件重写）

**Files:**
- Modify: `src-tauri/src/services/route_stream_continuation.rs`
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Consumes: `Task 3` 的模块；`route_proxy_stream::SseFramer`
- Produces:
  - `pub struct ResponsesResumeRewriter`
  - `ResponsesResumeRewriter::new(response_id: String, next_sequence_number: u64, next_output_index: u64)`
  - `rewrite_block(&mut self, block: &str) -> Result<Option<String>, String>`
  - `finish(&mut self, usage: &RouteUsageBreakdown) -> String`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn drops_created_and_renumbers_sequence_and_output_index() {
    let mut rw = ResponsesResumeRewriter::new("resp_1".into(), 10, 2);
    let created = r#"data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_2"}}"#;
    assert_eq!(rw.rewrite_block(created).unwrap(), None);

    let added = r#"data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_9","type":"message"}}"#;
    let out = rw.rewrite_block(added).unwrap().expect("block");
    let v: serde_json::Value = serde_json::from_str(out.trim_start_matches("data: ")).unwrap();
    assert_eq!(v["sequence_number"], 10);
    assert_eq!(v["output_index"], 2);
    assert_eq!(v["item"]["id"], "msg_9"); // item id 保持续写流自己的，便于 delta 对齐
}

#[test]
fn suppresses_upstream_completed_and_synthesizes_our_own() {
    let mut rw = ResponsesResumeRewriter::new("resp_1".into(), 10, 2);
    let done = r#"data: {"type":"response.completed","sequence_number":11,"response":{"id":"resp_2","status":"completed"}}"#;
    assert_eq!(rw.rewrite_block(done).unwrap(), None);
    let final_block = rw.finish(&RouteUsageBreakdown::default());
    assert!(final_block.contains(r#""type":"response.completed""#));
    assert!(final_block.contains(r#""id":"resp_1""#));
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib drops_created_and_renumbers`
Expected: 编译失败（`ResponsesResumeRewriter` 不存在）

- [ ] **Step 3: 实现**

```rust
pub struct ResponsesResumeRewriter {
    response_id: String,
    next_sequence_number: u64,
    next_output_index: u64,
}

impl ResponsesResumeRewriter {
    pub fn new(response_id: String, next_sequence_number: u64, next_output_index: u64) -> Self {
        Self { response_id, next_sequence_number, next_output_index }
    }

    /// 返回 `None` 表示这一块不再转发（`response.created` / 上游的 `response.completed`）。
    pub fn rewrite_block(&mut self, block: &str) -> Result<Option<String>, String> {
        let payload = block.lines()
            .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
            .collect::<Vec<_>>().join("\n");
        if payload.is_empty() { return Ok(None); }
        let mut value: Value = match serde_json::from_str(&payload) {
            Ok(value) => value,
            Err(_) => return Ok(Some(format!("{block}\n\n"))),
        };
        let event = value.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
        if event == "response.created" || event == "response.in_progress" { return Ok(None); }
        if event == "response.completed" { return Ok(None); }
        value["sequence_number"] = Value::from(self.next_sequence_number);
        self.next_sequence_number += 1;
        if event == "response.output_item.added" || event == "response.output_item.done" {
            value["output_index"] = Value::from(self.next_output_index);
            self.next_output_index += 1;
        } else if let Some(index) = value.get("output_index") {
            if index.as_u64().is_some() {
                value["output_index"] = Value::from(self.next_output_index.saturating_sub(1));
            }
        }
        Ok(Some(format!("data: {}\n\n", serde_json::to_string(&value)
            .map_err(|error| error.to_string())?)))
    }

    pub fn finish(&mut self, usage: &RouteUsageBreakdown) -> String {
        let value = json!({
            "type": "response.completed",
            "sequence_number": self.next_sequence_number,
            "response": { "id": self.response_id, "status": "completed", "object": "response",
                          "usage": usage_breakdown_to_json(usage) }
        });
        format!("data: {}\n\n", value)
    }
}
```

`usage_breakdown_to_json` 用 `route_proxy_service::usage_breakdown_from_value` 的反向映射补齐；
若已有等价 helper 就复用（实现时先 grep `usage` 序列化）。

**实现备忘（Task 1 实测，见 spec 12 节）**：客户端是从流式的 `output_item.*` 事件记录会话历史的，
`response.completed` 的 `response.output` 留空也不丢内容。所以 `finish()` 合成的收尾事件只要带
`id` / `status` / `usage` 即可，不必重建完整 output 数组。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib route_stream_continuation`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/route_stream_continuation.rs
git commit -m "feat(route): Responses 续写事件重写器"
```

---

### Task 5: 设置项 route_proxy_stream_continue_max

**Files:**
- Modify: `src-tauri/src/models/settings.rs`（`AppSettings` / `AppSettingsView`）
- Modify: `src/screens/SettingsScreen.tsx`
- Modify: `src/lib/api/types.ts`
- Test: `src-tauri/src/services/settings_service.rs`、`tests/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `AppSettings.route_proxy_stream_continue_max: u32`（默认 10）

- [ ] **Step 1: 写 Rust 失败测试**

```rust
#[test]
fn stream_continue_max_defaults_to_ten_and_round_trips() {
    let dir = tempdir().expect("tempdir");
    let paths = AppPaths::from_data_dir(dir.path().to_path_buf());
    let mut settings = SettingsService::load(&paths).await.expect("settings");
    assert_eq!(settings.route_proxy_stream_continue_max, 10);
    settings.route_proxy_stream_continue_max = 0;
    SettingsService::save(&paths, &settings).await.expect("save");
    let loaded = SettingsService::load(&paths).await.expect("load");
    assert_eq!(loaded.route_proxy_stream_continue_max, 0);
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib stream_continue_max_defaults`
Expected: 编译失败（字段不存在）

- [ ] **Step 3: 实现 Rust 侧**

```rust
pub const DEFAULT_ROUTE_PROXY_STREAM_CONTINUE_MAX: u32 = 10;

fn default_route_proxy_stream_continue_max() -> u32 { DEFAULT_ROUTE_PROXY_STREAM_CONTINUE_MAX }

// AppSettings / AppSettingsView 各加一个字段
#[serde(default = "default_route_proxy_stream_continue_max")]
pub route_proxy_stream_continue_max: u32,
```

`AppSettings::defaults_for_data_dir` 与 `view()` 里同步带上该字段。

- [ ] **Step 4: 跑 Rust 测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib stream_continue_max_defaults`
Expected: PASS

- [ ] **Step 5: 写前端失败测试**

```tsx
it("把流式续写次数写进设置", async () => {
  renderSettings();
  const input = await screen.findByLabelText("流式断流自动续写次数");
  await userEvent.clear(input);
  await userEvent.type(input, "3");
  await userEvent.tab();
  expect(updateSettings).toHaveBeenCalledWith(
    expect.objectContaining({ route_proxy_stream_continue_max: 3 }),
  );
});
```

- [ ] **Step 6: 实现前端**

`src/lib/api/types.ts` 的 `AppSettings` 上加 `route_proxy_stream_continue_max?: number;`；
`src/screens/SettingsScreen.tsx` 里挨着 `route_proxy_request_body_limit_mib` 加一个数字输入
（label 文案：`流式断流自动续写次数`，说明：`0 = 关闭；默认 10`），onChange 走与 body limit 相同的 update 路径。

- [ ] **Step 7: 跑前端测试与类型检查**

Run: `pnpm typecheck && pnpm vitest run tests/SettingsScreen.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/models/settings.rs src/screens/SettingsScreen.tsx src/lib/api/types.ts src-tauri/src/services/settings_service.rs tests/SettingsScreen.test.tsx
git commit -m "feat(route): 增加流式续写次数设置项（默认 10）"
```

---

### Task 6: 只缺收尾事件时补 response.completed（独立可交付）

**Files:**
- Modify: `src-tauri/src/services/route_proxy_service.rs`（`StreamCompletion::finish` 的 `truncated` 分支）
- Test: `src-tauri/src/services/route_proxy_service.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 2 的 `StreamContinuationState`（`open_item.is_none() && !completed_items.is_empty()`）
- Produces: 无新公开接口；行为变化——内容完整时不再报断流

- [ ] **Step 1: 写失败集成测试**

```rust
#[tokio::test]
async fn missing_terminal_event_is_completed_instead_of_reported_as_disconnect() {
    // 上游把 message item 完整发出（added/delta/done），就是不发 response.completed
    let (upstream, _) = start_scripted_sse_upstream(vec![
        b"data: {"type":"response.created","sequence_number":0,"response":{"id":"r1"}}

          data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"m1","type":"message"}}

          data: {"type":"response.output_text.delta","sequence_number":2,"item_id":"m1","delta":"完整回答"}

          data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"m1","type":"message","content":[{"type":"output_text","text":"完整回答"}]}}

".to_vec(),
    ]).await;
    // …建池、起代理（照 upstream_timeout_fails_over_to_next_pool_account 的脚手架）
    let body = response.bytes().await.expect("body");
    let text = String::from_utf8_lossy(&body);
    assert!(text.contains("response.completed"), "{text}");
    let credential = RouteCredentialRepository::get(&pool, &id).await.unwrap();
    assert_eq!(credential.transient_failure_count, 0);
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib missing_terminal_event_is_completed`
Expected: FAIL（当前会记一条 `semantic_response_transient`）

- [ ] **Step 3: 实现**

在 `StreamCompletion::finish` 的 `if truncated {` 分支最前面插入：

```rust
if truncated && completion_can_be_closed(&observer_state) {
    // 内容已经完整，只是缺收尾：直接补一条 response.completed，不记失败、不续写。
    let final_block = synthesize_completed_event(&observer_state, &usage);
    // 通过既有的流尾通道把 final_block 交给客户端（见实现说明：需要把该分支
    // 改成先 yield 一段字节再结束，而不是直接 return）。
    return;
}
```

实现说明（必须照做）：`finish()` 目前不产出字节，只做记账。补收尾的那条事件必须从
`observed_upstream_stream` 的 `None` 分支里 yield 出去，所以这一步要把判定上移到
`observed_upstream_stream`：在 `None =>` 分支里先问
`completion.should_synthesize_completion()`，为真则 `return Some((Ok(bytes), state))`，
下一次 poll 再走 `finish()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib missing_terminal_event`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/route_proxy_service.rs
git commit -m "feat(route): 内容完整只缺收尾时补 response.completed"
```

---

### Task 7: 文本续写拼接主路径

**Files:**
- Modify: `src-tauri/src/services/route_stream_continuation.rs`（`StreamContinuationPump`）
- Modify: `src-tauri/src/services/route_proxy_service.rs`（`observed_upstream_stream` 改为驱动泵）
- Test: `src-tauri/src/services/route_proxy_service.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 2/3/4/5
- Produces:
  - `pub struct ContinuationPlan { pub body: Vec<u8>, pub response_id: String, pub next_sequence_number: u64, pub next_output_index: u64 }`
  - `pub fn plan_continuation(original_body: &[u8], state: &StreamContinuationState) -> Option<ContinuationPlan>`

### Task 7 实现笔记（2026-10-09 探明，开工前先读）

- **重建上游请求不用手写**（2026-10-09 修正）：生产路径用的是
  `build_upstream_request_internal(credential, platform, path, query, headers, body, Some(&state.codex_history), TurnReminderMode::Apply, state.model_match_mode)`
  —— 见 `route_proxy_service.rs:1254`（计划早先写的 `build_upstream_request_with_bridge` 其实只在测试里调用）。
  它返回 `BuiltUpstreamRequest { target_url, headers, body, bridge_kind, tool_namespaces, streaming_request }`，
  **鉴权头由它负责**；聚合模式换账号续写就是「换一个 credential 再调一次」。
- **7a 已完成**（提交见 log）：`StreamCompletion` 现在带 `client_headers`（客户端原始请求头）与
  `upstream_query`，构造点取自 `outbound_headers` / `upstream_query`。续写时把这两个原样传给上面的构造器即可。
- `StreamCompletion` 已有 `client_request` / `upstream_request` / `path` / `target_url` / `platform` /
  `credential` / `state.pool`，够用。
- **动手前必须先定的三件事**（否则容易返工）：

  1. 传给 builder 的 `headers` 应当是**客户端原始请求头**，不是 `StreamCompletion.upstream_headers`
     （后者是发往上游的、含旧账号的鉴权）。当前没有存客户端头，需要给 `StreamCompletion` 加字段。
  2. 原请求的 **query**（如 `?beta=true`）没被保存，重建 URL 需要它，也要补进 `StreamCompletion`。
  3. 聚合模式下换账号：`select_pool_credentials(pool, platform)` 过滤掉当前 `credential.id` 后再交给 builder。

- [ ] **Step 1: 写失败集成测试（两次上游 + 一次续写）**

```rust
#[tokio::test]
async fn a_mid_text_cut_is_continued_into_the_same_response() {
    let (upstream, calls) = start_scripted_sse_upstream(vec![
        // 第一次：只发前半句就断
        b"data: {"type":"response.created","sequence_number":0,"response":{"id":"r1"}}

          data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"m1","type":"message"}}

          data: {"type":"response.output_text.delta","sequence_number":2,"item_id":"m1","delta":"前半句，"}

".to_vec(),
        // 第二次（续写）：新 response，但会被重写回 r1
        b"data: {"type":"response.created","sequence_number":0,"response":{"id":"r2"}}

          data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"m2","type":"message"}}

          data: {"type":"response.output_text.delta","sequence_number":2,"item_id":"m2","delta":"后半句。"}

          data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"m2","type":"message","content":[{"type":"output_text","text":"后半句。"}]}}

          data: {"type":"response.completed","sequence_number":4,"response":{"id":"r2","status":"completed"}}

".to_vec(),
    ]).await;
    // …建池（retry_count 0 使第一次失败即切账号，另建第二个 credential 指向同一 upstream）…
    let text = String::from_utf8_lossy(&body).to_string();
    assert!(text.contains("前半句，"));
    assert!(text.contains("后半句。"));
    assert_eq!(text.matches(""type":"response.created"").count(), 1);
    assert!(text.contains(""id":"r1""));
    assert!(text.contains("response.completed"));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib a_mid_text_cut_is_continued`
Expected: FAIL（客户端只收到前半句，且被记一次失败）

- [ ] **Step 3: 实现 `plan_continuation`**

```rust
pub fn plan_continuation(
    original_body: &[u8],
    state: &StreamContinuationState,
) -> Option<ContinuationPlan> {
    if state.text_truncated { return None; }              // 超内存上限，放弃
    let response_id = state.response_id.clone()?;
    if state.partial_text.is_empty() { return None; }      // 还没有可续的正文
    let body = build_continuation_body(original_body, &state.partial_text).ok()?;
    Some(ContinuationPlan {
        body,
        response_id,
        next_sequence_number: state.last_sequence_number + 1,
        next_output_index: state.completed_items.len() as u64, // 续写从下一个 item 位开始
    })
}
```

- [ ] **Step 4: 实现账号选择**

```rust
async fn pick_continuation_credential(
    state: &ProxyAppState,
    platform: &str,
    current_id: &str,
) -> Option<SelectedCredential> {
    let mode = RoutePoolRepository::model_mode(&state.pool, platform).await.ok()?;
    let candidates = select_pool_credentials(&state.pool, platform).await.ok()?;
    match mode {
        PoolModelMode::Precise => candidates.into_iter().find(|c| c.id == current_id),
        PoolModelMode::Aggregate => candidates
            .into_iter()
            .find(|c| c.id != current_id)
            .or_else(|| None),
    }
}
```

- [ ] **Step 5: 驱动泵（改 `observed_upstream_stream`）**

把 unfold 的状态从 `(stream, guard, transform)` 扩成
`(stream, guard, transform, Option<ContinuationRuntime>)`：当内层流返回 `None`/`Err` 且
`guard.completion.take()` 给出 `plan_continuation(...) == Some(plan)` 时：

1. `let credential = pick_continuation_credential(...).await`，失败则结束（保持今天的报错行为）；
2. 用 `build_outbound_http_client_with_timeouts(state.upstream_timeouts)` 发 `plan.body`；
3. 新建 `ResponsesResumeRewriter::new(plan.response_id, plan.next_sequence_number, plan.next_output_index)`；
4. 把新请求的字节流接进当前 unfold，后续 chunk 先过 rewriter 再 yield；
5. 新流也结束时补 `rewriter.finish(&merged_usage)` 并结束。

- [ ] **Step 5b: 处理上游是 Chat 的那条路（`ResponsesToChat`）**

`bridge_kind == Some(ProtocolBridgeKind::ResponsesToChat)` 时，客户端看到的 Responses 事件是
`ChatStreamBridge` 自己合成的（它维护 `sequence_number`、并靠 `ensure_stream_started` 决定要不要发
`response.created`），所以这条路**不需要 `ResponsesResumeRewriter`**，而是把**同一个 bridge 实例跨两次
上游请求沿用**：

1. 断流时不销毁 `StreamResponseTransform` 里的 `IncrementalResponseBridge`；
2. 续写拿到的是 Chat SSE，用同一个 bridge 实例继续 `push_block`——`stream_started` 已为真，不会再发第二条 `response.created`；
3. 续写流的 Chat 侧终止帧也吞掉，由网关在全部结束后补 `response.completed`。

用 `start_scripted_sse_upstream` 造一个 **Chat SSE** 上游，断言客户端只看到一条 `response.created`、两段文字都在。

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib a_mid_text_cut_is_continued_over_chat_bridge`
Expected: PASS

- [ ] **Step 6: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib a_mid_text_cut_is_continued`
Expected: PASS

- [ ] **Step 7: 补预算测试**

```rust
#[tokio::test]
async fn continuation_stops_at_the_configured_budget() {
    // 让上游每次都只发半句就断，设置 route_proxy_stream_continue_max = 2，
    // 断言：上游一共被请求 1 + 2 次，最后一条响应仍以报错结束、并记一次失败。
}
```

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib continuation_stops_at_the_configured_budget`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/services/route_proxy_service.rs src-tauri/src/services/route_stream_continuation.rs
git commit -m "feat(route): 文本断流自动续写并拼接回同一响应"
```

---

### Task 7c 实现笔记（2026-10-09，已完成）

Task 7 的文本续写主路径与 Chat 桥路径都已落地并提交，几处与计划原文不同、以代码为准：

- **续写请求的基底是客户端请求体**（`StreamCompletion.client_request`），不是发往上游的那份。
  对 `ResponsesToChat` 来说上游体已经是 Chat 形状、没有 `input`；`build_continuation_body`
  追加的是 Responses 形状的 input 项，所以必须先拼好再交给
  `build_upstream_request_internal` 重新做一次桥接/映射/净化。
- **`observed_upstream_stream` 里是一个 `StreamPump`**，不是裸的 unfold 元组。它持有内层流、
  `StreamStage`（`Primary`/`Resume`）、已用轮次、以及 `continuing`/`done` 两个标志。
- **续写流的帧不写原响应的事件状态**：`StreamObserver::observe_continuation` 只并 token 用量、
  只把 `response.output_text.delta`（或 Chat 的 `choices[0].delta.content`）接到 `partial_text`
  后面。走 `observe` 会把 `response_id` 覆盖成续写流自己的 id，让第二轮错位；同时
  `saw_terminal_marker` 被续写流的收尾事件置真后，原账号的断流就不会被记账了。
- **Chat 桥的续写状态从桥的输出里读**：原始 Chat 帧没有 `response.created`，所以桥每轮吐出的
  Responses 事件会再喂一遍 `StreamObserver::observe_client_events`。续写轮里桥上正文已由
  `observe_continuation` 收过，不再重复。
- **预算用尽时按断流收尾**：续写流再次断掉且没有预算，就丢掉半截记录、不补假的
  `response.completed`，让客户端按断流处理，并照旧给原账号记一次 `semantic_response_transient`。
- **顺手修了 Task 4 重写器的一个 `output_index` bug**：`response.output_item.done` 之前会和
  `added` 一样自增，导致同一个 item 的 added/done 落在两个不同的 index 上；现在只有 `added`
  占新位，`done` 与 delta 复用同一个。
- **设置项接进运行态**：`RouteProxyRuntimeState`/`ProxyAppState` 各加 `stream_continue_max`
  （`Arc<AtomicU32>`），`save_settings_core` 保存时刷新，默认 10、0 关闭。

---

### Task 8: 工具调用延迟提交与不可恢复边界

**Files:**
- Modify: `src-tauri/src/services/route_stream_continuation.rs`
- Test: 同文件 + `route_proxy_service.rs` 集成用例

**Interfaces:**
- Consumes: Task 2/4/7
- Produces: `pub fn is_holdback_item(kind: OpenItemKind) -> bool`（`FunctionCall` / `Reasoning` 为真）

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn function_call_arguments_are_held_back_until_done() {
    let mut pump = harness_for_holdback();
    pump.feed_block(added_function_call("fc_1"));
    pump.feed_block(arguments_delta("fc_1", "{\"a\":"));
    assert!(pump.forwarded().is_empty(), "参数没收完前不得转发");
    pump.feed_block(item_done("fc_1"));
    assert!(pump.forwarded().join("").contains("fc_1"));
}

#[test]
fn a_cut_inside_function_call_drops_the_item_instead_of_forwarding_it() {
    let mut pump = harness_for_holdback();
    pump.feed_block(added_function_call("fc_1"));
    pump.feed_block(arguments_delta("fc_1", "{\"a\":"));
    let plan = pump.cut();
    assert!(plan.is_some(), "应当重新请求而不是放弃");
    assert!(!pump.forwarded().join("").contains("fc_1"), "半截调用不能到客户端");
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib function_call_arguments_are_held_back`
Expected: 编译失败（holdback 不存在）

- [ ] **Step 3: 实现**

`ResponsesResumeRewriter` 增加一个按 `item_id` 的暂存区：收到
`response.output_item.added`（`item.type == "function_call"` 或 `"reasoning"`）时不立即输出，
把该 item 的全部块缓存；收到对应的 `response.output_item.done` 时一次性按序输出；
上游提前结束时丢弃缓存并把 `plan_continuation` 的 `partial_text` 换成"不带那半截工具调用"的正文。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib function_call`
Expected: PASS

- [ ] **Step 5: 补不可恢复边界测试**

```rust
#[test]
fn a_cut_inside_encrypted_reasoning_abandons_continuation() {
    // open_item.kind == Reasoning && item.encrypted_content 非空 → plan_continuation == None
}
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/route_stream_continuation.rs src-tauri/src/services/route_proxy_service.rs
git commit -m "feat(route): 工具调用延迟提交与不可恢复边界"
```

---

### Task 9: 记账、日志与文档收尾

**Files:**
- Modify: `src-tauri/src/services/route_proxy_service.rs`（续写日志与记账断言）
- Modify: `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`（补"实现结果"一节）

**Interfaces:**
- Consumes: Task 7/8
- Produces: 无新接口

- [ ] **Step 1: 写失败测试（记账不变）**

```rust
#[tokio::test]
async fn a_continued_request_still_charges_the_failing_account_once() {
    // 第一次上游断流、续写成功；断言原账号 transient_failure_count == 1、
    // last_failure_kind == "semantic_response_transient"，且客户端看到的是完整回答。
}
```

- [ ] **Step 2: 运行看它失败**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib a_continued_request_still_charges`
Expected: FAIL

- [ ] **Step 3: 实现：断流仍旧记账 + 续写写日志**

```rust
// 断流那一刻照旧 record_route_credential_failure(..., "semantic_response_transient", ...)，
// 续写成功不回滚这条记录。
//
// 仓库没有 tracing 依赖，不要引新依赖：把轮次写进请求事件的 metadata，
// 人肉排查沿用仓库既有做法 eprintln!。
let mut metadata = route_proxy_request_metadata(/* 与现有调用同样的参数 */);
metadata["continuation_round"] = serde_json::json!(continuation_round);
let _ = insert_route_credential_request_event(state, &credential.id, &metadata,
    &RouteUsageBreakdown::default(), None).await;
eprintln!(
    "[route-continuation] credential={} round={} model={:?}",
    credential.display_name, continuation_round, model_key
);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib a_continued_request_still_charges`
Expected: PASS

- [ ] **Step 5: 跑完整验证**

Run:
```bash
cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib
pnpm typecheck && pnpm test:run
```
Expected: 全绿

- [ ] **Step 6: 更新 spec 并提交**

在 spec 末尾追加「## 15. 实现结果」记录：落地了哪些任务、`route_proxy_stream_continue_max` 的
实际默认值、未实现/降级的边界。

```bash
git add src-tauri/src/services/route_proxy_service.rs docs/superpowers/specs/2026-10-09-stream-continuation-design.md
git commit -m "feat(route): 续写记账、日志与文档收尾"
```

---

## 交付顺序与可独立上线的切片

1. Task 1 是**硬门槛**：不通过就停。
2. Task 6 可**单独上线**（内容完整只缺收尾 → 不再报错），收益立竿见影、风险最低。
3. Task 2–5 是 7/8 的地基，可合并成一次提交上线（无行为变化）。
4. Task 7 是主路径；Task 8 补安全边界；Task 9 收尾。
