<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type Tab = { id: string; label: string; title: string; body: string };

const props = defineProps<{
  tabs: Tab[];
  windowLabel: string;
  windowBadge: string;
  isEn?: boolean;
  compact?: boolean;
}>();

const active = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

const UI = {
  root: {
    agents: "智能体",
    tools: "工作台",
    pool: "算力池",
    sessions: "会话",
    usage: "用量统计",
    mcp: "MCP 服务器",
    skills: "技能管理",
    settings: "应用设置",
    proxy: "代理已启动",
    add: "新增账号",
    test: "真实生成测试",
    write: "写入客户端配置",
    poolHead: "池内账号",
    routeState: "路由状态",
    priority: "优先级",
    concurrency: "并发",
    success: "成功率",
    balance: "余额",
    healthy: "正常",
    cooling: "冷却中",
    standby: "备用",
    autoNote: "优先级 1 占满或异常时，请求自动落到下一级账号",
    cliEntry: "本地入口",
    upstream: "上游方言",
    translate: "双向协议转换 · 流式同样生效",
    requests: "请求",
    input: "输入 Token",
    output: "输出 Token",
    cache: "缓存 Token",
    total: "Token 总计",
    cost: "总费用",
    recent: "最近请求",
    account: "账号",
    model: "模型",
    status: "状态",
    ok: "成功",
    terminalTitle: "Vibe 终端",
    localSessions: "本地会话",
    resume: "恢复",
    launch: "启动智能体",
    panelCaptions: "点击上方标签切换视图",
  },
  en: {
    agents: "Agents",
    tools: "Workspace",
    pool: "Route pool",
    sessions: "Sessions",
    usage: "Usage",
    mcp: "MCP servers",
    skills: "Skills",
    settings: "Settings",
    proxy: "Proxy running",
    add: "Add account",
    test: "Generation test",
    write: "Write CLI config",
    poolHead: "Accounts in pool",
    routeState: "Routing",
    priority: "Priority",
    concurrency: "Concurrency",
    success: "Success",
    balance: "Balance",
    healthy: "Healthy",
    cooling: "Cooling down",
    standby: "Standby",
    autoNote: "When priority 1 is saturated or failing, traffic falls through automatically",
    cliEntry: "Local entry",
    upstream: "Upstream dialect",
    translate: "Two-way conversion · streaming included",
    requests: "Requests",
    input: "Input tokens",
    output: "Output tokens",
    cache: "Cache tokens",
    total: "Total tokens",
    cost: "Total cost",
    recent: "Recent requests",
    account: "Account",
    model: "Model",
    status: "Status",
    ok: "OK",
    terminalTitle: "Vibe terminal",
    localSessions: "Local sessions",
    resume: "Resume",
    launch: "Launch agent",
    panelCaptions: "Click a tab above to switch views",
  },
};

const u = computed(() => (props.isEn ? UI.en : UI.root));
const current = computed(() => props.tabs[active.value] ?? props.tabs[0]);

const AGENTS = [
  { key: "codex", name: "Codex", on: true },
  { key: "claude", name: "Claude Code", on: false },
  { key: "gemini", name: "Gemini CLI", on: false },
  { key: "grok", name: "Grok", on: false },
  { key: "opencode", name: "OpenCode", on: false },
  { key: "openclaw", name: "OpenClaw", on: false },
  { key: "hermes", name: "Hermes", on: false },
];

const ACCOUNTS = [
  { name: "主力中转 A", short: "Primary A", tier: "P1", conc: "5", rate: "99.2%", balance: "$37.70", state: "healthy", width: "82%" },
  { name: "主力中转 B", short: "Primary B", tier: "P1", conc: "5", rate: "98.6%", balance: "$21.40", state: "healthy", width: "68%" },
  { name: "备用账号 C", short: "Backup C", tier: "P3", conc: "3", rate: "97.1%", balance: "$66.00", state: "standby", width: "41%" },
  { name: "兜底账号 D", short: "Fallback D", tier: "P5", conc: "1", rate: "—", balance: "$12.05", state: "cooling", width: "18%" },
];

const BARS = [34, 52, 41, 67, 58, 76, 63, 88, 72, 95, 81, 69];

function select(i: number) {
  active.value = i;
}

function startAutoplay() {
  if (props.compact) return;
  stopAutoplay();
  timer = setInterval(() => {
    active.value = (active.value + 1) % props.tabs.length;
  }, 7000);
}

function stopAutoplay() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

onMounted(startAutoplay);
onBeforeUnmount(stopAutoplay);
</script>

<template>
  <div
    class="sw-window"
    :class="{ 'sw-compact': compact }"
    @mouseenter="stopAutoplay"
    @mouseleave="startAutoplay"
  >
    <div class="sw-bar">
      <span class="sw-dots"><i /><i /><i /></span>
      <span class="sw-title">{{ windowLabel }}</span>
      <span class="sw-badge"><span class="sw-pulse" />{{ windowBadge }}</span>
    </div>

    <div class="sw-body">
      <aside class="sw-side">
        <p class="sw-group">{{ u.agents }}</p>
        <div
          v-for="a in AGENTS"
          :key="a.key"
          class="sw-agent"
          :class="{ 'sw-agent-on': a.on }"
        >
          <span class="sw-agent-dot" :class="`sw-dot-${a.key}`" />
          <span>{{ a.name }}</span>
        </div>
        <p class="sw-group sw-group-2">{{ u.tools }}</p>
        <div class="sw-sideitem"><span class="sw-sideicon">◇</span>{{ u.mcp }}</div>
        <div class="sw-sideitem"><span class="sw-sideicon">✦</span>{{ u.skills }}</div>
        <div class="sw-sideitem"><span class="sw-sideicon">▤</span>{{ u.sessions }}</div>
        <div class="sw-sideitem"><span class="sw-sideicon">◫</span>{{ u.usage }}</div>
        <div class="sw-sidefoot"><span class="sw-sideicon">⚙</span>{{ u.settings }}</div>
      </aside>

      <div class="sw-main">
        <div class="sw-tabs">
          <button
            v-for="(tab, i) in tabs"
            :key="tab.id"
            class="sw-tab"
            :class="{ 'sw-tab-on': active === i }"
            type="button"
            @click="select(i)"
          >
            {{ tab.label }}
          </button>
          <span class="sw-proxy-addr">127.0.0.1:19527</span>
        </div>

        <!-- Pool ------------------------------------------------------ -->
        <div v-if="tabs[active]?.id === 'pool'" class="sw-panel sw-pool">
          <div class="sw-toolrow">
            <div class="sw-toolgroup">
              <span class="sw-tool-primary">＋ {{ u.add }}</span>
              <span class="sw-tool">▶ {{ u.proxy }}</span>
              <span class="sw-tool">✈ {{ u.test }}</span>
            </div>
            <span class="sw-tool-write">🔌 {{ u.write }}</span>
          </div>
          <div class="sw-mini-stats">
            <div><b>4</b><span>{{ u.poolHead }}</span></div>
            <div><b>P1 → P5</b><span>{{ u.routeState }}</span></div>
            <div><b>1,284</b><span>{{ u.requests }}</span></div>
          </div>
          <div class="sw-table-head">
            <span>{{ u.account }}</span><span>{{ u.priority }}</span><span>{{ u.concurrency }}</span
            ><span>{{ u.success }}</span><span>{{ u.balance }}</span>
          </div>
          <div v-for="(a, i) in ACCOUNTS" :key="a.name" class="sw-account">
            <span class="sw-account-name">
              <i class="sw-state" :class="`sw-state-${a.state}`" />
              <span>
                <b>{{ isEn ? a.short : a.name }}</b>
                <em :style="{ width: a.width }" />
              </span>
            </span>
            <span class="sw-chip" :class="`sw-chip-${i}`">{{ a.tier }}</span>
            <span class="sw-dim">{{ a.conc }}</span>
            <span class="sw-dim">{{ a.rate }}</span>
            <span class="sw-money">{{ a.balance }}</span>
          </div>
          <p class="sw-footnote">↳ {{ u.autoNote }}</p>
        </div>

        <!-- Bridge ---------------------------------------------------- -->
        <div v-else-if="tabs[active]?.id === 'bridge'" class="sw-panel sw-bridge">
          <div class="sw-bridge-grid">
            <div class="sw-bridge-col">
              <p class="sw-col-title">{{ u.cliEntry }}</p>
              <div class="sw-node sw-node-strong">
                <b>Codex</b><code>/responses</code><small>OpenAI Responses</small>
              </div>
              <div class="sw-node">
                <b>Claude Code</b><code>/v1/messages</code><small>Anthropic Messages</small>
              </div>
            </div>
            <div class="sw-bridge-mid">
              <span class="sw-beam"><i /><i /><i /></span>
              <div class="sw-core">
                <span class="sw-core-logo">AS</span>
                <b>AI Switch</b>
                <small>19527</small>
              </div>
              <span class="sw-beam sw-beam-r"><i /><i /><i /></span>
            </div>
            <div class="sw-bridge-col">
              <p class="sw-col-title">{{ u.upstream }}</p>
              <div v-for="(d, i) in ['openai', 'openai-responses', 'anthropic', 'gemini']" :key="d" class="sw-node sw-node-dialect" :class="`sw-d-${i}`">
                <code>{{ d }}</code>
              </div>
            </div>
          </div>
          <div class="sw-bridge-note">
            <span class="sw-convert-icon">⇄</span>
            <span>{{ u.translate }}</span>
            <code>ResponsesToChat</code>
          </div>
        </div>

        <!-- Stats ----------------------------------------------------- -->
        <div v-else-if="tabs[active]?.id === 'stats'" class="sw-panel sw-stats">
          <div class="sw-kpis">
            <div><span>{{ u.requests }}</span><b>1,284</b></div>
            <div><span>{{ u.input }}</span><b>2.41M</b></div>
            <div><span>{{ u.output }}</span><b>684K</b></div>
            <div><span>{{ u.cache }}</span><b>1.08M</b></div>
            <div><span>{{ u.total }}</span><b>3.09M</b></div>
            <div class="sw-kpi-cost"><span>{{ u.cost }}</span><b>$55.02</b></div>
          </div>
          <div class="sw-chart">
            <div v-for="(h, i) in BARS" :key="i" class="sw-bar-col" :style="{ height: `${h}%` }" />
          </div>
          <div class="sw-recent">
            <p class="sw-col-title">{{ u.recent }}</p>
            <div class="sw-recent-row"><span>14:32</span><span>{{ u.account }} A</span><code>gpt-5.5</code><span class="sw-ok">● {{ u.ok }}</span><b>$0.0421</b></div>
            <div class="sw-recent-row"><span>14:31</span><span>{{ u.account }} B</span><code>claude-sonnet</code><span class="sw-ok">● {{ u.ok }}</span><b>$0.0386</b></div>
            <div class="sw-recent-row"><span>14:29</span><span>{{ u.account }} A</span><code>gpt-5.5</code><span class="sw-ok">● {{ u.ok }}</span><b>¥0.2710</b></div>
          </div>
        </div>

        <!-- Terminal -------------------------------------------------- -->
        <div v-else class="sw-panel sw-term">
          <div class="sw-term-grid">
            <div class="sw-sessions">
              <p class="sw-col-title">{{ u.localSessions }}</p>
              <div v-for="(s, i) in ['api-gateway / refactor', 'docs-site / layout', 'ai-switch / proxy', 'scratch / prompt']" :key="s" class="sw-session" :class="{ 'sw-session-on': i === 0 }">
                <span class="sw-session-icon">▤</span>
                <span>{{ s }}</span>
                <em>{{ u.resume }}</em>
              </div>
            </div>
            <div class="sw-term-screen">
              <div class="sw-term-head"><span>◉</span> {{ u.terminalTitle }} — zsh</div>
              <div class="sw-term-lines">
                <p><span class="sw-prompt">➜</span> <span class="sw-dir">~/repos/ai-switch</span> codex</p>
                <p class="sw-muted">╭──────────────────────────────────────────────╮</p>
                <p class="sw-muted">│  connected to <span class="sw-green">127.0.0.1:19527</span>  ·  pool: <span class="sw-cyan">P1</span> │</p>
                <p class="sw-muted">╰──────────────────────────────────────────────╯</p>
                <p><span class="sw-user">›</span> 检查一下算力池的失败转移逻辑</p>
                <p class="sw-muted">● reading src-tauri/src/services/route_pool.rs</p>
                <p class="sw-green">✓ 3 accounts healthy · 1 cooling down</p>
                <p><span class="sw-prompt">➜</span> <span class="sw-cursor">▌</span></p>
              </div>
            </div>
          </div>
          <div class="sw-launchbar">
            <span class="sw-launch-label">{{ u.launch }}</span>
            <span class="sw-launch-pill sw-launch-on">Codex</span>
            <span class="sw-launch-pill">Claude</span>
            <span class="sw-launch-pill">Gemini</span>
            <span class="sw-launch-pill">Grok</span>
            <span class="sw-launch-go">▶</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!compact" class="sw-caption">
      <div class="sw-caption-text">
        <b>{{ current.title }}</b>
        <p>{{ current.body }}</p>
      </div>
      <span class="sw-caption-hint">{{ u.panelCaptions }}</span>
    </div>
  </div>
</template>

<style scoped>
.sw-window {
  --sw-bg: #0d1216;
  --sw-panel: #131a20;
  --sw-line: rgba(255, 255, 255, 0.09);
  --sw-text: #e8eef2;
  --sw-dim: #8a99a6;
  position: relative;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 16px;
  background: var(--sw-bg);
  box-shadow: 0 40px 90px -30px rgba(2, 8, 12, 0.75), 0 0 0 1px rgba(16, 185, 129, 0.08);
  overflow: hidden;
  color: var(--sw-text);
  font-size: 12.5px;
}

.sw-window::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.7), rgba(245, 158, 11, 0.6), transparent);
}

.sw-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 40px;
  padding: 0 16px;
  background: #0a0f13;
  border-bottom: 1px solid var(--sw-line);
}

.sw-dots { display: inline-flex; gap: 6px; }
.sw-dots i { width: 9px; height: 9px; border-radius: 50%; background: #3b4650; }
.sw-dots i:first-child { background: #f87171; }
.sw-dots i:nth-child(2) { background: #fbbf24; }
.sw-dots i:nth-child(3) { background: #34d399; }

.sw-title { font-weight: 600; color: #cbd5dc; letter-spacing: 0.01em; }
.sw-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(52, 211, 153, 0.28);
  background: rgba(16, 185, 129, 0.12);
  color: #6ee7b7;
  font-size: 11px;
  font-weight: 600;
}
.sw-pulse { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2); animation: sw-pulse 2s ease-in-out infinite; }
@keyframes sw-pulse { 50% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); } }

.sw-body { display: grid; grid-template-columns: 168px minmax(0, 1fr); min-height: 330px; }

.sw-side { padding: 16px 10px; border-right: 1px solid var(--sw-line); background: #0b1115; }
.sw-group { margin: 0 0 8px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #697987; }
.sw-group-2 { margin-top: 20px; }
.sw-agent, .sw-sideitem, .sw-sidefoot {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 10px;
  border-radius: 7px;
  color: #9aabba;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sw-agent-on { background: rgba(16, 185, 129, 0.14); color: #a7f3d0; font-weight: 600; }
.sw-agent-dot { width: 8px; height: 8px; border-radius: 3px; background: #64748b; flex: none; }
.sw-dot-codex { background: linear-gradient(135deg, #b1a7ff, #3941ff); }
.sw-dot-claude { background: #d97757; }
.sw-dot-gemini { background: linear-gradient(135deg, #ee4d5d, #207cfe); }
.sw-dot-grok { background: #22d3ee; }
.sw-dot-opencode { background: #94a3b8; }
.sw-dot-openclaw { background: #ff4d4d; }
.sw-dot-hermes { background: #00e5cc; }
.sw-sideicon { width: 14px; text-align: center; color: #6b7c8b; flex: none; }
.sw-sidefoot { margin-top: 18px; border-top: 1px solid var(--sw-line); border-radius: 0; padding-top: 12px; }

.sw-main { min-width: 0; display: flex; flex-direction: column; }
.sw-tabs { display: flex; align-items: center; gap: 2px; padding: 10px 14px 0; border-bottom: 1px solid var(--sw-line); }
.sw-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: #8a99a6;
  font: inherit;
  font-size: 12px;
  padding: 7px 12px 10px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease;
}
.sw-tab:hover { color: #e8eef2; }
.sw-tab-on { color: #6ee7b7; border-bottom-color: #34d399; font-weight: 650; }
.sw-proxy-addr { margin-left: auto; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }

.sw-panel { flex: 1; padding: 16px; min-height: 270px; }

/* pool */
.sw-toolrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.sw-toolgroup { display: flex; gap: 6px; flex-wrap: wrap; }
.sw-tool, .sw-tool-primary, .sw-tool-write {
  padding: 5px 9px;
  border: 1px solid var(--sw-line);
  border-radius: 6px;
  color: #a9b8c4;
  font-size: 10.5px;
  white-space: nowrap;
}
.sw-tool-primary { border-color: rgba(52, 211, 153, 0.4); background: rgba(16, 185, 129, 0.16); color: #6ee7b7; }
.sw-tool-write { border-color: rgba(245, 158, 11, 0.32); color: #fcd34d; }
.sw-mini-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.sw-mini-stats > div { padding: 9px 11px; border: 1px solid var(--sw-line); border-radius: 8px; background: var(--sw-panel); }
.sw-mini-stats b { display: block; font-size: 15px; color: #f1f5f9; }
.sw-mini-stats span { display: block; margin-top: 3px; font-size: 10px; color: var(--sw-dim); }
.sw-table-head, .sw-account { display: grid; grid-template-columns: minmax(0, 2fr) 0.8fr 0.8fr 0.9fr 1fr; gap: 8px; align-items: center; }
.sw-table-head { padding: 0 10px 7px; font-size: 10px; color: #6b7c8b; letter-spacing: 0.04em; }
.sw-account { padding: 8px 10px; border: 1px solid var(--sw-line); border-radius: 8px; background: var(--sw-panel); margin-bottom: 6px; }
.sw-account-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sw-account-name > span { min-width: 0; flex: 1; }
.sw-account-name b { display: block; font-size: 11.5px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-account-name em { display: block; height: 3px; margin-top: 5px; border-radius: 999px; background: linear-gradient(90deg, #34d399, #0ea5e9); }
.sw-state { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #34d399; }
.sw-state-standby { background: #fbbf24; }
.sw-state-cooling { background: #f87171; }
.sw-chip { justify-self: start; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; background: rgba(52, 211, 153, 0.16); color: #6ee7b7; }
.sw-chip-2 { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
.sw-chip-3 { background: rgba(248, 113, 113, 0.16); color: #fca5a5; }
.sw-dim { color: var(--sw-dim); font-size: 11px; }
.sw-money { color: #fcd34d; font-size: 11px; font-weight: 600; text-align: right; }
.sw-footnote { margin: 10px 0 0; color: #6ee7b7; font-size: 10.5px; }

/* bridge */
.sw-bridge-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 12px; align-items: center; }
.sw-col-title { margin: 0 0 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #697987; }
.sw-node { padding: 8px 10px; margin-bottom: 7px; border: 1px solid var(--sw-line); border-radius: 8px; background: var(--sw-panel); }
.sw-node b { display: block; font-size: 11.5px; }
.sw-node code { display: block; margin: 2px 0; font-size: 10.5px; color: #7dd3fc; }
.sw-node small { font-size: 10px; color: var(--sw-dim); }
.sw-node-strong { border-color: rgba(52, 211, 153, 0.35); }
.sw-node-dialect { border-left: 2px solid #f59e0b; padding: 7px 10px; }
.sw-node-dialect code { margin: 0; color: #fcd34d; font-size: 11px; }
.sw-d-1 { border-left-color: #38bdf8; }
.sw-d-1 code { color: #7dd3fc; }
.sw-d-2 { border-left-color: #a78bfa; }
.sw-d-2 code { color: #c4b5fd; }
.sw-d-3 { border-left-color: #fb7185; }
.sw-d-3 code { color: #fda4af; }
.sw-bridge-mid { display: flex; align-items: center; gap: 5px; }
.sw-core { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 10px; border: 1px solid rgba(52, 211, 153, 0.45); border-radius: 10px; background: linear-gradient(160deg, #12352c, #0b1519); box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.08); }
.sw-core-logo { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #04140f; font-size: 10px; font-weight: 800; }
.sw-core b { font-size: 10px; color: #e2e8f0; }
.sw-core small { font-size: 9px; color: #6ee7b7; }
.sw-beam { display: flex; flex-direction: column; gap: 4px; }
.sw-beam i { display: block; width: 14px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, transparent, #34d399); animation: sw-flow 1.6s linear infinite; }
.sw-beam i:nth-child(2) { animation-delay: 0.3s; }
.sw-beam i:nth-child(3) { animation-delay: 0.6s; }
.sw-beam-r i { background: linear-gradient(90deg, #38bdf8, transparent); }
@keyframes sw-flow { 0%, 100% { opacity: 0.25; transform: translateX(0); } 50% { opacity: 1; transform: translateX(3px); } }
.sw-bridge-note { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 9px 12px; border: 1px dashed rgba(148, 163, 184, 0.28); border-radius: 8px; color: #a9b8c4; font-size: 11px; }
.sw-bridge-note code { margin-left: auto; color: #6ee7b7; font-size: 10.5px; }
.sw-convert-icon { color: #34d399; font-size: 16px; }

/* stats */
.sw-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; }
.sw-kpis > div { padding: 9px 8px; border: 1px solid var(--sw-line); border-radius: 8px; background: var(--sw-panel); }
.sw-kpis span { display: block; font-size: 9.5px; color: var(--sw-dim); white-space: nowrap; }
.sw-kpis b { display: block; margin-top: 5px; font-size: 14px; color: #f1f5f9; }
.sw-kpi-cost b { color: #fcd34d; }
.sw-chart { display: flex; align-items: flex-end; gap: 6px; height: 76px; margin: 14px 0; padding: 8px 10px 0; border-bottom: 1px solid var(--sw-line); }
.sw-bar-col { flex: 1; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, #34d399, rgba(14, 165, 233, 0.35)); opacity: 0.85; }
.sw-bar-col:nth-child(3n) { background: linear-gradient(180deg, #fbbf24, rgba(245, 158, 11, 0.25)); }
.sw-recent-row { display: grid; grid-template-columns: 46px minmax(0, 1.2fr) minmax(0, 1.2fr) 0.8fr 60px; gap: 8px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--sw-line); color: #9aabba; font-size: 10.5px; }
.sw-recent-row code { color: #7dd3fc; font-size: 10px; }
.sw-recent-row b { text-align: right; color: #fcd34d; font-size: 10.5px; }
.sw-ok { color: #6ee7b7; font-size: 10px; }

/* terminal */
.sw-term-grid { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 10px; }
.sw-session { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 7px; color: #9aabba; font-size: 10.5px; }
.sw-session-on { background: rgba(56, 189, 248, 0.1); color: #bae6fd; }
.sw-session-icon { color: #64748b; }
.sw-session em { margin-left: auto; font-style: normal; font-size: 9.5px; color: #6ee7b7; }
.sw-term-screen { border: 1px solid var(--sw-line); border-radius: 8px; background: #080d11; overflow: hidden; }
.sw-term-head { padding: 6px 10px; border-bottom: 1px solid var(--sw-line); color: #8a99a6; font-size: 10px; }
.sw-term-head span { color: #34d399; }
.sw-term-lines { padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; line-height: 1.75; }
.sw-term-lines p { margin: 0; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-muted { color: #64748b !important; }
.sw-green { color: #6ee7b7; }
.sw-cyan { color: #7dd3fc; }
.sw-prompt { color: #34d399; font-weight: 700; }
.sw-dir { color: #7dd3fc; }
.sw-user { color: #fbbf24; }
.sw-cursor { color: #6ee7b7; animation: sw-blink 1s step-end infinite; }
@keyframes sw-blink { 50% { opacity: 0; } }
.sw-launchbar { display: flex; align-items: center; gap: 7px; margin-top: 13px; padding: 8px 10px; border: 1px solid var(--sw-line); border-radius: 8px; background: var(--sw-panel); }
.sw-launch-label { color: #697987; font-size: 10px; margin-right: 4px; white-space: nowrap; }
.sw-launch-pill { padding: 3px 9px; border: 1px solid var(--sw-line); border-radius: 999px; color: #9aabba; font-size: 10px; }
.sw-launch-on { border-color: rgba(52, 211, 153, 0.4); background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }
.sw-launch-go { margin-left: auto; color: #34d399; }

/* caption */
.sw-caption { display: flex; align-items: flex-start; gap: 16px; padding: 14px 18px 16px; border-top: 1px solid var(--sw-line); background: #0a0f13; }
.sw-caption-text b { display: block; font-size: 13px; color: #e8eef2; }
.sw-caption-text p { margin: 4px 0 0; max-width: 70ch; font-size: 11.5px; line-height: 1.65; color: #8a99a6; }
.sw-caption-hint { margin-left: auto; flex: none; padding-top: 2px; color: #5b6b78; font-size: 10px; }

/* compact (hero) */
.sw-compact .sw-body { min-height: 264px; }
.sw-compact .sw-panel { min-height: 220px; padding: 12px; }
.sw-compact .sw-side { padding: 12px 8px; }
.sw-compact .sw-agent, .sw-compact .sw-sideitem { padding: 4px 8px; font-size: 11px; }
.sw-compact .sw-group-2 { margin-top: 12px; }
.sw-compact .sw-sidefoot { margin-top: 10px; padding-top: 8px; }
.sw-compact .sw-tabs { padding-top: 8px; }
.sw-compact .sw-tab { padding: 5px 9px 8px; font-size: 11px; }
.sw-compact .sw-tool-write, .sw-compact .sw-tool:nth-child(3) { display: none; }
.sw-compact .sw-mini-stats { margin-bottom: 10px; }
.sw-compact .sw-account { padding: 6px 8px; margin-bottom: 4px; }
.sw-compact .sw-footnote { margin-top: 7px; font-size: 10px; }
.sw-compact .sw-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sw-compact .sw-term-grid { grid-template-columns: 120px minmax(0, 1fr); }
.sw-compact .sw-bridge-grid { gap: 6px; }
.sw-compact .sw-beam i { width: 8px; }

@media (max-width: 900px) {
  .sw-body { grid-template-columns: 128px minmax(0, 1fr); }
  .sw-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sw-caption-hint { display: none; }
}

@media (max-width: 620px) {
  .sw-side { display: none; }
  .sw-body { grid-template-columns: minmax(0, 1fr); }
  .sw-proxy-addr { display: none; }
  .sw-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sw-table-head, .sw-account { grid-template-columns: minmax(0, 1.6fr) 0.7fr 0.9fr; }
  .sw-table-head span:nth-child(3), .sw-account .sw-dim:nth-of-type(2) { display: none; }
  .sw-bridge-grid { grid-template-columns: minmax(0, 1fr); }
  .sw-bridge-mid { justify-content: center; }
  .sw-beam { display: none; }
  .sw-term-grid { grid-template-columns: minmax(0, 1fr); }
  .sw-sessions { display: none; }
  .sw-recent-row { grid-template-columns: 40px minmax(0, 1fr) 50px; }
  .sw-recent-row code, .sw-recent-row .sw-ok { display: none; }
}
</style>
