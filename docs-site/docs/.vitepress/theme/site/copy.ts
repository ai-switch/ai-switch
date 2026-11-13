/**
 * All marketing copy for the AI Switch home page.
 *
 * `root` is Simplified Chinese and `en` is English. The two objects are kept
 * structurally identical so a single template can render both locales. Paths
 * in `to` fields are document routes WITHOUT the .html suffix — HomePage.vue
 * adds the suffix with `doc()` because this site builds with cleanUrls: false.
 */

export const REPO = "https://github.com/ai-switch/ai-switch";
export const RELEASES = `${REPO}/releases/latest`;
export const ISSUES = `${REPO}/issues`;
export const DISCUSSIONS = `${REPO}/discussions`;

export const LINUX_INSTALL_COMMAND =
  'AI_SWITCH_PORT=19527 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/ai-switch/ai-switch/main/scripts/install-server.sh)"';

export const PLATFORMS = [
  { key: "codex", name: "Codex", tier: "full" },
  { key: "claude", name: "Claude Code", tier: "full" },
  { key: "gemini", name: "Gemini CLI", tier: "full" },
  { key: "grok", name: "Grok", tier: "full" },
  { key: "opencode", name: "OpenCode", tier: "generic" },
  { key: "openclaw", name: "OpenClaw", tier: "generic" },
  { key: "hermes", name: "Hermes", tier: "generic" },
] as const;

export const STACK = [
  "Tauri 2",
  "Rust",
  "axum",
  "sqlx",
  "SQLite",
  "React 18",
  "TypeScript",
  "Go sidecar",
  "Tailscale tsnet",
  "rustls",
];

export const COPY = {
  root: {
    announcement: "v0.18.0 已发布 · 本地路由、算力池与用量统计全面升级",
    announcementLink: "查看更新",

    hero: {
      eyebrow: "开源 · MIT 许可 · 本地优先",
      titleA: "一个入口，",
      titleB: "接管所有 AI CLI 的账号与流量",
      lead: "AI Switch 把 Codex、Claude Code、Gemini CLI、Grok 等 7 个平台的账号、协议和算力集中到一处：本地代理统一入口，算力池自动调度与故障转移，上游协议按需桥接。桌面应用与自托管 Web 服务共用同一份数据与界面。",
      primary: "免费下载",
      secondary: "5 分钟快速开始",
      tertiary: "在 GitHub 上查看",
      hint: "Windows · macOS · Linux　|　无需注册，配置只存本机",
      stats: [
        { value: "7", label: "智能体平台" },
        { value: "4", label: "种上游协议" },
        { value: "1", label: "个本地代理入口" },
        { value: "MIT", label: "开源许可" },
      ],
      windowLabel: "AI Switch · 算力池",
      windowBadge: "代理运行中",
    },

    trust: {
      title: "一套配置，覆盖你正在用的命令行工具",
      note: "7 个平台都可以路由 API、写入原生配置；Codex、Claude Code、Gemini CLI、Grok 额外支持官方账号导入。",
      badges: ["本地运行，不上云", "MIT 开源免费", "Windows / macOS / Linux", "桌面端自动更新"],
      matrix: "查看完整能力矩阵",
    },

    pain: {
      eyebrow: "为什么要换一种做法",
      title: "还在四个配置文件之间来回改 key？",
      lead: "手改配置能切一次账号。账号一多、协议一杂、限流一来，剩下的麻烦都在「切换之后」。",
      beforeTitle: "以前：手动改配置",
      afterTitle: "现在：交给算力池",
      before: [
        "同一个 key 要在 TOML、JSON、YAML、.env 里分别填一遍",
        "换供应商要找到文件、改 base URL、改 key，改错 CLI 直接起不来",
        "额度用完只看到 429，得自己发现、自己换号、自己重启",
        "Codex 只说 Responses，手上的 Chat Completions 账号根本用不上",
        "花了多少钱、哪个号在扛流量，全靠猜",
      ],
      after: [
        "一个界面管理 7 个平台的账号，原生配置由安全直写自动完成",
        "一键切换或让代理按优先级自动选号，原有配置项原样保留",
        "限流、超时、额度耗尽自动降级到备用账号，到点自动恢复",
        "四种上游协议双向桥接，协议不通的账号也能用起来",
        "每次请求的 token、命中账号、价格与失败原因都有记录",
      ],
      switchLabel: "AI Switch",
      safeNote: "写配置前建快照、原子写入、检测并发修改、支持带守卫回滚。",
    },

    features: {
      eyebrow: "核心能力",
      title: "不只是切换器，是一整套流量调度层",
      lead: "从账号管理到请求转发、从协议翻译到成本对账，全部收敛在一个本地进程里。",
      items: [
        {
          icon: "pool",
          title: "算力池调度",
          body: "1–5 级优先级分层，层内轮转，按账号设并发上限。主力号不可用，流量自动落到下一级。",
          to: "/guide/accounts",
        },
        {
          icon: "bridge",
          title: "四种协议桥接",
          body: "本地入口讲 CLI 的母语，代理把请求翻译成 Chat Completions、Responses、Messages 或 Gemini。",
          to: "/guide/protocol-routing",
        },
        {
          icon: "shield",
          title: "故障转移与自愈",
          body: "区分瞬时失败与语义失败，冷却、退避、重试队列与探活恢复，账号状态全程可观测。",
          to: "/guide/reliability",
        },
        {
          icon: "chart",
          title: "用量与成本",
          body: "逐请求记录输入 / 输出 / 缓存 token 与美元、人民币计价，还能读取本机会话用量对照。",
          to: "/guide/usage-stats",
        },
        {
          icon: "write",
          title: "安全直写配置",
          body: "7 个平台各写各的原生文件，先快照、再原子写入，支持并发检测与回滚，不覆盖你的其他配置。",
          to: "/guide/platform-support",
        },
        {
          icon: "test",
          title: "真实生成测试",
          body: "不是 ping 一下就完事：真的让上游生成内容，并给出完整请求链路、trace id 与原始响应。",
          to: "/guide/model-test",
        },
        {
          icon: "terminal",
          title: "Vibe 终端工作区",
          body: "内置多标签 PTY 终端，直接拉起智能体、恢复历史会话，还有可自定义的皮肤包。",
          to: "/features/vibe",
        },
        {
          icon: "plugin",
          title: "MCP 与技能管理",
          body: "一次添加 MCP 服务器，勾选同步到 11 个客户端；内置 2 个技能包共 27 个技能。",
          to: "/features/mcp",
        },
        {
          icon: "globe",
          title: "桌面与自托管",
          body: "同一份 React 界面、同一个 Rust 核心：桌面走 IPC，浏览器走 HTTP + WebSocket，手机也能用。",
          to: "/deploy/web-service",
        },
      ],
      more: "浏览全部功能文档",
    },

    showcase: {
      eyebrow: "产品导览",
      title: "一个界面，看清楚每一次请求",
      lead: "点开下面的标签，看看账号、协议、花费和终端在同一个工作台里是什么样子。",
      tabs: [
        {
          id: "pool",
          label: "算力池",
          title: "账号、优先级、状态，一屏看完",
          body: "每个账号带优先级、并发上限、成功率与余额徽标。拖一下就能改同层轮转顺序，挂了的号会自动退出调度。",
        },
        {
          id: "bridge",
          label: "协议桥接",
          title: "CLI 不变，上游随便换",
          body: "Codex 发 /responses，代理按命中账号的方言改写请求，再把响应转回 Responses 格式，流式也一样。",
        },
        {
          id: "stats",
          label: "用量统计",
          title: "钱花在哪个号上，有据可查",
          body: "当日 / 本周 / 本月 / 累计四个窗口，六张指标卡加逐条请求列表，估算价会单独标记。",
        },
        {
          id: "terminal",
          label: "终端会话",
          title: "在同一个窗口里把活干完",
          body: "左侧是扫描到的本地会话，中间是真实 PTY 终端，底部按平台一键拉起 CLI 或恢复上次会话。",
        },
      ],
      more: "阅读快速开始",
    },

    flow: {
      eyebrow: "工作原理",
      title: "请求从 CLI 到上游，中间发生了什么",
      lead: "一个端口、一次选号、一层翻译。你只需要把 CLI 指向本地代理，剩下的交给它。",
      steps: [
        { idx: "01", name: "CLI 发请求", body: "Codex / Claude Code / Gemini CLI 仍按自己的协议，连到 127.0.0.1:19527。", tag: "/responses · /v1/messages" },
        { idx: "02", name: "识别与鉴权", body: "代理用本地 key 识别平台，剥掉本地认证头，绝不会把代理 key 发给上游。", tag: "sk-ai-switch-*" },
        { idx: "03", name: "算力池选号", body: "按优先级分组轮转，过滤冷却 / 归档 / 并发占满的账号，取到租约才放行。", tag: "priority 1 → 5" },
        { idx: "04", name: "协议桥接", body: "模型映射、工具兼容、推理内容回填之后，把请求改写成上游方言并转发。", tag: "7 条桥接链路" },
        { idx: "05", name: "回传与记账", body: "响应反向转回入口格式，同时写入用量事件、更新账号状态、推送实时日志。", tag: "token · price · trace" },
      ],
      dialects: ["openai", "openai-responses", "anthropic", "gemini"],
      dialectTitle: "四种上游方言",
      bridgeTitle: "核心桥接链路",
      bridges: [
        "Responses → Chat Completions",
        "Responses → Responses",
        "Responses → Anthropic",
        "Responses → Gemini",
        "Messages → Chat Completions",
        "Messages → Responses",
        "Messages → Gemini",
      ],
      more: "深入协议路由",
    },

    tutorials: {
      eyebrow: "教程中心",
      title: "照着做就能跑通的实战教程",
      lead: "从第一条请求到团队自建，六篇教程覆盖最常见的使用场景，每篇都给出可复制的步骤与命令。",
      items: [
        {
          tag: "入门",
          minutes: "5 分钟",
          title: "跑通第一条请求",
          body: "装好应用、添加一个路由账号、启动代理、写入 CLI 配置，最后在统计里看到这条请求。",
          to: "/tutorials/first-request",
        },
        {
          tag: "协议",
          minutes: "8 分钟",
          title: "用 Chat 中转账号驱动 Codex",
          body: "手里只有 OpenAI 兼容的第三方 key？用协议桥接让 Codex 照样工作，不用改 CLI 一个字。",
          to: "/tutorials/codex-with-chat-relay",
        },
        {
          tag: "进阶",
          minutes: "10 分钟",
          title: "搭一个不会断的算力池",
          body: "主力 / 备用 / 兜底三层优先级，配合并发上限、冷却与自动恢复，让限流时无感切换。",
          to: "/tutorials/failover-pool",
        },
        {
          tag: "协议",
          minutes: "8 分钟",
          title: "让 Claude Code 用任意上游",
          body: "Messages 入口可以打进任何池，把 Claude Code 接到 OpenAI 或 Gemini 协议的账号上。",
          to: "/tutorials/claude-with-any-upstream",
        },
        {
          tag: "运维",
          minutes: "7 分钟",
          title: "用量、费用与对账",
          body: "看懂六张指标卡与请求列表，配置自定义模型价格，分清上游实价与本地估算。",
          to: "/tutorials/usage-and-cost",
        },
        {
          tag: "部署",
          minutes: "12 分钟",
          title: "手机访问与团队自建",
          body: "Web 服务、Tailscale 私网、独立服务器与 Docker 四条路径，按场景选一条。",
          to: "/tutorials/remote-and-team",
        },
      ],
      more: "进入教程中心",
    },

    deploy: {
      eyebrow: "部署形态",
      title: "四种用法，同一份数据与界面",
      lead: "桌面端与浏览器端共用同一套 React 界面和同一个 Rust 核心，代理行为完全一致，不存在功能阉割版。",
      items: [
        { name: "桌面应用", body: "Tauri 2 原生外壳，通过 IPC 直连核心。装完即用，支持签名自动更新。", to: "/deploy/desktop" },
        { name: "局域网浏览器", body: "开启 Web 服务，用访问令牌鉴权，同一 Wi-Fi 下手机、平板都能打开。", to: "/deploy/web-service" },
        { name: "Tailscale 私网", body: "不暴露公网端口、不用自己张罗证书，在私有网络里远程管理。", to: "/deploy/remote-access" },
        { name: "独立服务器 / Docker", body: "ai-switch-server 二进制或容器，放在 NAS 与服务器上给团队共用。", to: "/deploy/standalone-server" },
      ],
      note: "默认绑定 127.0.0.1:19527。面板流量与模型 API 共用一个端口，但分别用访问令牌与路由代理密钥鉴权。所有 /api/* 与 /ws/events 请求都需要令牌，走 Tailscale 也一样。",
      more: "查看全部部署方式",
    },

    compare: {
      eyebrow: "能力对照",
      title: "手动改配置 vs AI Switch",
      lead: "如果你只有一个账号、从不切换，手改确实够用。差别从第二个账号开始。",
      headManual: "手动改配置文件",
      headSwitch: "AI Switch",
      rows: [
        { label: "多平台配置", manual: "每个 CLI 一种格式，逐个文件改", value: "一个界面写入 7 个平台的原生配置" },
        { label: "写入安全", manual: "改错直接起不来，没有回滚", value: "快照 + 原子写入 + 并发检测 + 守卫回滚" },
        { label: "账号切换", manual: "手动改 key、保存、重启 CLI", value: "一键切换，或按优先级自动选号" },
        { label: "失败处理", manual: "429 / 5xx 自己发现、自己处理", value: "自动重试、冷却、降级到备用账号" },
        { label: "协议兼容", manual: "协议不匹配就用不了", value: "四种上游方言双向桥接，流式也转换" },
        { label: "可观测性", manual: "看不到命中账号、token 与花费", value: "逐请求用量、价格、trace 与四阶段实时日志" },
        { label: "远程管理", manual: "只能坐在这台机器前", value: "浏览器 / 手机 / Tailscale / 自建服务器" },
      ],
    },

    faq: {
      eyebrow: "常见问题",
      title: "开始之前，你可能想问",
      lead: "下面是真实用户最常问的八个问题，答案都对应到具体文档。",
      items: [
        {
          q: "和直接改 CLI 配置文件有什么区别？",
          a: "手改能切一次账号，AI Switch 解决的是切换之后的事：多平台统一写入、安全回滚、按优先级自动选号、失败自动降级、逐请求用量与错误记录。只有一个账号且不切换时，手改确实够用。",
          to: "/faq",
        },
        {
          q: "支持哪些平台？「部分支持」是什么意思？",
          a: "共 7 个平台。Codex、Claude Code、Gemini CLI、Grok 是原生支持；OpenCode、OpenClaw、Hermes 是 agent harness，没有自己的官方登录态，所以官方账号导入与额度查询对它们不存在，但 API 路由和原生配置写入都有。",
          to: "/guide/platform-support",
        },
        {
          q: "什么是协议桥接？我什么时候需要它？",
          a: "CLI 和上游服务说的「方言」可能不一致，代理在中间做双向翻译。比如你只有 Chat Completions 的中转账号却想用 Codex，或者想让 Claude Code 走 OpenAI 兼容端点，就靠它。协议天然匹配时不会介入，请求原样转发。",
          to: "/guide/protocol-routing",
        },
        {
          q: "API Key 存在哪里，安全吗？",
          a: "存在本机 ~/.ai-switch/ai-switch.db 的 SQLite 数据库里，当前版本没有对密钥列做静态加密。请按凭据目录对待整个 ~/.ai-switch：收紧权限、不要放进公开仓库或明文同步盘、备份时加密。Web 服务另有访问令牌保护。",
          to: "/faq",
        },
        {
          q: "账号额度用完会怎样？",
          a: "记录失败类型与上游原始错误，区分瞬时失败与额度耗尽，冷却后把请求交给池里的下一个账号；自动恢复调度器可按计划或探活把账号放回池子。优先级 1–5、并发上限都可逐账号设置。",
          to: "/guide/reliability",
        },
        {
          q: "能在手机或另一台电脑上用吗？",
          a: "可以。开启 Web 服务后用浏览器访问并输入访问令牌，功能与桌面端一致。默认只监听 127.0.0.1，要远程访问就改绑定地址或启用 Tailscale；令牌校验在 Tailscale 与 Funnel 下都不会被跳过。",
          to: "/deploy/web-service",
        },
        {
          q: "和 cc-switch 是什么关系？",
          a: "AI Switch 是独立从零实现的开源项目，只兼容它的配置与导入格式，方便迁移；新增账号对话框可以直接只读导入本机 CC Switch 的 API 账号。除此之外没有关系，不复用其代码。",
          to: "/faq",
        },
        {
          q: "开源吗？可以二次开发吗？",
          a: "MIT 许可，可自由使用、修改、分发（含商用），只需保留版权与许可声明。仓库里有架构总览、本地开发、发布流程与独立服务器文档，页脚「开发者」一栏可以直接进入。",
          to: "/dev/architecture",
        },
      ],
      more: "阅读完整 FAQ",
    },

    opensource: {
      eyebrow: "开源与社区",
      title: "代码公开，数据留在你手里",
      lead: "AI Switch 是 MIT 许可的独立项目。没有账号体系，没有必须连接的云服务，配置与凭据都在本机数据目录。",
      points: [
        { title: "MIT 许可", body: "自由使用、修改与商用，保留版权声明即可。" },
        { title: "本地优先", body: "SQLite 存账号与设置，代理只监听回环地址。" },
        { title: "三平台构建", body: "Windows、macOS、Linux 由 CI 分别构建并签名发布。" },
      ],
      primary: "在 GitHub 上查看源码",
      secondary: "提交问题与建议",
      sponsor: "支持项目",
    },

    download: {
      eyebrow: "开始使用",
      title: "装好就能用，五分钟跑通第一条请求",
      lead: "桌面端免费开源，自动更新；服务器上没有桌面环境就用一键安装脚本跑独立服务。",
      primary: "下载桌面版",
      secondary: "阅读安装指南",
      os: [
        { name: "Windows", format: "NSIS 安装器 · .exe" },
        { name: "macOS", format: ".dmg / .app" },
        { name: "Linux", format: ".deb / .AppImage" },
      ],
      commandTitle: "Linux 服务器一键安装",
      commandNote: "把 19527 换成你需要的端口；安装器会自动启动服务并输出访问地址。",
      copy: "复制命令",
      copied: "已复制",
      note: "桌面端支持带 minisign 验签的自动更新。所有 Release 资产与更新清单都在 GitHub Releases。",
    },

    footer: {
      tagline: "一个壳里统一管理所有 AI API。开源、本地优先、跨平台。",
      columns: [
        {
          title: "产品",
          links: [
            { text: "核心能力", to: "/features/vibe" },
            { text: "平台支持矩阵", to: "/guide/platform-support" },
            { text: "协议路由与桥接", to: "/guide/protocol-routing" },
            { text: "用量与请求统计", to: "/guide/usage-stats" },
            { text: "模型连通性测试", to: "/guide/model-test" },
            { text: "中转站", to: "/relay/" },
          ],
        },
        {
          title: "教程",
          links: [
            { text: "教程中心", to: "/tutorials/" },
            { text: "跑通第一条请求", to: "/tutorials/first-request" },
            { text: "Codex + Chat 中转", to: "/tutorials/codex-with-chat-relay" },
            { text: "不会断的算力池", to: "/tutorials/failover-pool" },
            { text: "用量与费用对账", to: "/tutorials/usage-and-cost" },
            { text: "远程访问与自建", to: "/tutorials/remote-and-team" },
          ],
        },
        {
          title: "指南",
          links: [
            { text: "AI Switch 是什么", to: "/guide/introduction" },
            { text: "安装", to: "/guide/installation" },
            { text: "快速开始", to: "/guide/quick-start" },
            { text: "账号与算力池", to: "/guide/accounts" },
            { text: "稳定性与自动恢复", to: "/guide/reliability" },
            { text: "常见问题", to: "/faq" },
          ],
        },
        {
          title: "部署",
          links: [
            { text: "桌面端", to: "/deploy/desktop" },
            { text: "Web 服务模式", to: "/deploy/web-service" },
            { text: "独立服务器", to: "/deploy/standalone-server" },
            { text: "Docker 部署", to: "/deploy/docker" },
            { text: "远程访问与 HTTPS", to: "/deploy/remote-access" },
          ],
        },
        {
          title: "开发者 · 二次开发",
          links: [
            { text: "架构总览", to: "/dev/architecture" },
            { text: "本地开发", to: "/dev/local-setup" },
            { text: "发布流程", to: "/dev/release" },
            { text: "中转站接入规范", to: "/relay/spec" },
            { text: "GitHub 源码", href: REPO },
            { text: "提交 Issue", href: ISSUES },
          ],
        },
        {
          title: "资源",
          links: [
            { text: "下载与更新日志", href: RELEASES },
            { text: "社区讨论", href: DISCUSSIONS },
            { text: "赞助项目", to: "/sponsor" },
            { text: "MIT 许可", href: `${REPO}/blob/main/LICENSE` },
          ],
        },
      ],
      built: "基于 MIT 许可发布 · Copyright © 2026 xyito",
      disclaimer: "本站为 AI Switch 开源项目的官方文档与官网。文中第三方产品名称归其各自所有者所有。",
    },
  },

  en: {
    announcement: "v0.18.0 is out · Local routing, pool scheduling and usage stats, refined",
    announcementLink: "What's new",

    hero: {
      eyebrow: "Open source · MIT · Local first",
      titleA: "One entry point.",
      titleB: "Every AI CLI account, every upstream protocol",
      lead: "AI Switch brings the accounts, protocols and capacity behind Codex, Claude Code, Gemini CLI, Grok and more into one place: a single local proxy, automatic pool scheduling with failover, and on-demand upstream protocol bridging. The desktop app and the self-hosted web service share the same data and the same UI.",
      primary: "Download for free",
      secondary: "Quick start in 5 min",
      tertiary: "View on GitHub",
      hint: "Windows · macOS · Linux　|　No sign-up. Config stays on your machine.",
      stats: [
        { value: "7", label: "agent platforms" },
        { value: "4", label: "upstream protocols" },
        { value: "1", label: "local proxy entry" },
        { value: "MIT", label: "licensed" },
      ],
      windowLabel: "AI Switch · Route Pool",
      windowBadge: "Proxy running",
    },

    trust: {
      title: "One setup for the CLI tools you already use",
      note: "All seven platforms route API traffic and get native config written by AI Switch. Codex, Claude Code, Gemini CLI and Grok also support official account import.",
      badges: ["Runs locally, no cloud", "MIT licensed and free", "Windows / macOS / Linux", "Signed auto updates"],
      matrix: "Full capability matrix",
    },

    pain: {
      eyebrow: "Why switch",
      title: "Still editing four config files to rotate one key?",
      lead: "Hand-editing can switch an account once. The real trouble starts after the switch — more accounts, mixed protocols, rate limits.",
      beforeTitle: "Before · hand-edited config",
      afterTitle: "After · a route pool",
      before: [
        "The same key goes into TOML, JSON, YAML and .env files, each with its own shape",
        "Switching providers means finding the file, editing base URL and key; one typo breaks the CLI",
        "When quota runs out you get a 429, then notice, swap the key and restart by hand",
        "Codex only speaks Responses, so a Chat Completions relay account sits unused",
        "No idea which account served traffic or what the spend looks like",
      ],
      after: [
        "One UI manages accounts for 7 platforms; native config is written safely for you",
        "Switch with one click, or let the proxy pick by priority; existing settings are preserved",
        "Rate limits, timeouts and exhausted quota fall through to a backup account automatically",
        "Four upstream dialects are translated both ways, so mismatched accounts become usable",
        "Every request records tokens, the account hit, price and failure reason",
      ],
      switchLabel: "AI Switch",
      safeNote: "Every config write takes a snapshot, writes atomically, detects concurrent edits and supports guarded rollback.",
    },

    features: {
      eyebrow: "Core capabilities",
      title: "More than a switcher — a traffic scheduling layer",
      lead: "From account management and request forwarding to protocol translation and cost reconciliation, all inside one local process.",
      items: [
        {
          icon: "pool",
          title: "Pool scheduling",
          body: "Five priority tiers with in-tier round robin and per-account concurrency caps. When the primary is out, traffic falls through automatically.",
          to: "/guide/accounts",
        },
        {
          icon: "bridge",
          title: "Four protocol bridges",
          body: "The CLI keeps its native dialect; the proxy translates to Chat Completions, Responses, Messages or Gemini generateContent.",
          to: "/guide/protocol-routing",
        },
        {
          icon: "shield",
          title: "Failover and recovery",
          body: "Transient versus semantic failures, cooldowns, backoff, a retry queue and probe-based recovery — all observable per account.",
          to: "/guide/reliability",
        },
        {
          icon: "chart",
          title: "Usage and cost",
          body: "Input, output and cache tokens per request, priced in USD and CNY, plus local CLI session usage for comparison.",
          to: "/guide/usage-stats",
        },
        {
          icon: "write",
          title: "Safe native writes",
          body: "Each of the 7 platforms gets its own native file, with snapshots, atomic writes, conflict detection and rollback.",
          to: "/guide/platform-support",
        },
        {
          icon: "test",
          title: "Real generation tests",
          body: "Not a ping: the upstream actually generates content, and you get the full route chain, trace id and raw response.",
          to: "/guide/model-test",
        },
        {
          icon: "terminal",
          title: "Vibe terminal workspace",
          body: "A built-in multi-tab PTY terminal that launches agents and resumes local sessions, with customizable skin packs.",
          to: "/features/vibe",
        },
        {
          icon: "plugin",
          title: "MCP and skills",
          body: "Add an MCP server once and sync it to 11 clients; two bundled skill packages ship 27 skills.",
          to: "/features/mcp",
        },
        {
          icon: "globe",
          title: "Desktop and self-hosted",
          body: "One React UI and one Rust core: Tauri IPC on desktop, HTTP + WebSocket in the browser, usable from a phone.",
          to: "/deploy/web-service",
        },
      ],
      more: "Browse all feature docs",
    },

    showcase: {
      eyebrow: "Product tour",
      title: "One screen for every request",
      lead: "Click through the tabs to see accounts, protocols, spend and the terminal living in the same workspace.",
      tabs: [
        {
          id: "pool",
          label: "Route pool",
          title: "Accounts, priorities and status at a glance",
          body: "Each account carries priority, concurrency cap, success rate and balance badge. Drag to change in-tier order; unhealthy accounts leave scheduling on their own.",
        },
        {
          id: "bridge",
          label: "Bridging",
          title: "Keep the CLI, change the upstream",
          body: "Codex sends /responses; the proxy rewrites it for the dialect of the account it picked, then converts the reply back — streaming included.",
        },
        {
          id: "stats",
          label: "Usage stats",
          title: "Know exactly where the money went",
          body: "Four time windows, six metric cards and a per-request list. Locally estimated prices are marked so they never pose as real billing.",
        },
        {
          id: "terminal",
          label: "Terminal",
          title: "Finish the work in the same window",
          body: "Local sessions on the left, a real PTY terminal in the middle, and a launcher that resumes sessions or starts an agent.",
        },
      ],
      more: "Read the quick start",
    },

    flow: {
      eyebrow: "How it works",
      title: "What happens between your CLI and the upstream",
      lead: "One port, one pool lookup, one translation layer. Point your CLI at the local proxy and let it handle the rest.",
      steps: [
        { idx: "01", name: "CLI request", body: "Codex / Claude Code / Gemini CLI keep speaking their own protocol into 127.0.0.1:19527.", tag: "/responses · /v1/messages" },
        { idx: "02", name: "Identify and auth", body: "The proxy resolves the platform from a local key, then strips that auth header — the proxy key never reaches the upstream.", tag: "sk-ai-switch-*" },
        { idx: "03", name: "Pick an account", body: "Priority tiers with round robin; cooled, archived and saturated accounts are filtered out before a lease is taken.", tag: "priority 1 → 5" },
        { idx: "04", name: "Bridge the protocol", body: "Model mapping, tool compatibility and reasoning backfill, then the request is rewritten for the upstream dialect.", tag: "7 bridge routes" },
        { idx: "05", name: "Return and record", body: "The response is converted back, a usage event is written, account state updated and live logs pushed.", tag: "token · price · trace" },
      ],
      dialects: ["openai", "openai-responses", "anthropic", "gemini"],
      dialectTitle: "Four upstream dialects",
      bridgeTitle: "Core bridge routes",
      bridges: [
        "Responses → Chat Completions",
        "Responses → Responses",
        "Responses → Anthropic",
        "Responses → Gemini",
        "Messages → Chat Completions",
        "Messages → Responses",
        "Messages → Gemini",
      ],
      more: "Deep dive into routing",
    },

    tutorials: {
      eyebrow: "Tutorials",
      title: "Hands-on guides you can actually follow",
      lead: "From the first request to a team server, six guides cover the most common scenarios with copy-pasteable steps and commands.",
      items: [
        {
          tag: "Start",
          minutes: "5 min",
          title: "Your first request",
          body: "Install the app, add a route account, start the proxy, write CLI config and see the request show up in usage stats.",
          to: "/tutorials/first-request",
        },
        {
          tag: "Protocol",
          minutes: "8 min",
          title: "Run Codex on a Chat relay",
          body: "Only have an OpenAI-compatible third-party key? Bridging makes it work with Codex without touching CLI config.",
          to: "/tutorials/codex-with-chat-relay",
        },
        {
          tag: "Advanced",
          minutes: "10 min",
          title: "Build a pool that never stalls",
          body: "Primary / backup / last-resort tiers plus concurrency caps, cooldown and automatic recovery for invisible failover.",
          to: "/tutorials/failover-pool",
        },
        {
          tag: "Protocol",
          minutes: "8 min",
          title: "Any upstream for Claude Code",
          body: "The Messages entry can reach any pool — connect Claude Code to OpenAI- or Gemini-speaking accounts.",
          to: "/tutorials/claude-with-any-upstream",
        },
        {
          tag: "Ops",
          minutes: "7 min",
          title: "Usage, spend and reconciliation",
          body: "Understand the six metric cards and request list, set custom model prices, and tell real prices from estimates.",
          to: "/tutorials/usage-and-cost",
        },
        {
          tag: "Deploy",
          minutes: "12 min",
          title: "Phone access and team servers",
          body: "Four paths — Web service, Tailscale private net, standalone server and Docker. Pick the one that fits.",
          to: "/tutorials/remote-and-team",
        },
      ],
      more: "Open the tutorial hub",
    },

    deploy: {
      eyebrow: "Deployment",
      title: "Four shapes, one dataset and one UI",
      lead: "Desktop and browser share the same React UI and the same Rust core, so proxy behaviour is identical — there is no stripped-down web version.",
      items: [
        { name: "Desktop app", body: "A native Tauri 2 shell over IPC. Install and go, with signed auto updates.", to: "/deploy/desktop" },
        { name: "LAN browser", body: "Turn on the web service with token auth and open it from a phone or tablet on the same network.", to: "/deploy/web-service" },
        { name: "Tailscale private net", body: "Reach it remotely without exposing a public port or managing certificates yourself.", to: "/deploy/remote-access" },
        { name: "Standalone / Docker", body: "Run the ai-switch-server binary or a container on a NAS or server for a whole team.", to: "/deploy/standalone-server" },
      ],
      note: "Default bind is 127.0.0.1:19527. Panel traffic and model API share one port but authenticate separately with a web token and a route proxy key. Every /api/* and /ws/events request needs the token — Tailscale included.",
      more: "See all deployment options",
    },

    compare: {
      eyebrow: "Side by side",
      title: "Hand-edited config vs AI Switch",
      lead: "With one account and no switching, hand-editing is fine. The gap opens at account number two.",
      headManual: "Hand-edited config",
      headSwitch: "AI Switch",
      rows: [
        { label: "Multi-platform setup", manual: "One format per CLI, file by file", value: "One UI writes native config for 7 platforms" },
        { label: "Write safety", manual: "A typo breaks the CLI, no rollback", value: "Snapshot + atomic write + conflict detection + rollback" },
        { label: "Account switching", manual: "Edit key, save, restart the CLI", value: "One click, or automatic pick by priority" },
        { label: "Failure handling", manual: "You notice a 429 and deal with it", value: "Retry, cooldown and fallthrough to a backup" },
        { label: "Protocol fit", manual: "Mismatched protocols are unusable", value: "Four upstream dialects bridged both ways, streaming included" },
        { label: "Observability", manual: "No idea which account, tokens or cost", value: "Per-request usage, price, trace and four-stage live logs" },
        { label: "Remote management", manual: "Only at this machine", value: "Browser, phone, Tailscale or your own server" },
      ],
    },

    faq: {
      eyebrow: "FAQ",
      title: "Questions worth asking first",
      lead: "Eight questions real users ask most, with answers that link to the exact docs.",
      items: [
        {
          q: "How is this different from editing CLI config directly?",
          a: "Hand-editing switches one account. AI Switch handles what comes after: unified multi-platform writes, safe rollback, priority-based selection, automatic failover and per-request usage and error records. With a single account and no switching, hand-editing is enough.",
          to: "/faq",
        },
        {
          q: "Which platforms are supported? What does partial mean?",
          a: "Seven in total. Codex, Claude Code, Gemini CLI and Grok are native; OpenCode, OpenClaw and Hermes are agent harnesses with no official sign-in of their own, so official account import and quota queries do not exist for them — API routing and native config writes still do.",
          to: "/guide/platform-support",
        },
        {
          q: "What is protocol bridging and when do I need it?",
          a: "The CLI and the upstream may speak different dialects; the proxy translates both ways. It matters when you only have a Chat Completions relay key but want Codex, or want Claude Code on an OpenAI-compatible endpoint. Matching protocols pass through untouched.",
          to: "/guide/protocol-routing",
        },
        {
          q: "Where are API keys stored? Is it safe?",
          a: "In a local SQLite database at ~/.ai-switch/ai-switch.db. The current version does not encrypt the secret column at rest, so treat the whole ~/.ai-switch directory as a credential store: tighten permissions, keep it out of public repos and plaintext sync, and encrypt backups. The web service adds token auth.",
          to: "/faq",
        },
        {
          q: "What happens when an account runs out of quota?",
          a: "The failure kind and raw upstream error are recorded, transient failures differ from quota exhaustion, and after a cooldown the request goes to the next account in the pool. A recovery scheduler can re-enable accounts on a schedule or via health probes. Priority 1–5 and concurrency caps are per account.",
          to: "/guide/reliability",
        },
        {
          q: "Can I use it from a phone or another computer?",
          a: "Yes. Turn on the web service, open it in a browser and enter the access token — the feature set matches desktop. It listens on 127.0.0.1 by default, so remote access needs a different bind or Tailscale. Token checks are never skipped, not even over Tailscale or Funnel.",
          to: "/deploy/web-service",
        },
        {
          q: "What is the relationship with cc-switch?",
          a: "AI Switch is an independent project built from scratch. It only understands the same config and import formats so migration is easy, and the add-account dialog can read CC Switch's API accounts read-only from this machine. No code is reused.",
          to: "/faq",
        },
        {
          q: "Is it open source? Can I build on it?",
          a: "MIT licensed: use, modify and distribute freely, including commercially, as long as you keep the copyright and license notice. Architecture, local setup, release process and standalone server docs are all linked from the Developer column in the footer.",
          to: "/dev/architecture",
        },
      ],
      more: "Read the full FAQ",
    },

    opensource: {
      eyebrow: "Open source",
      title: "Open code. Your data stays yours.",
      lead: "AI Switch is an independent MIT-licensed project. No account system, no mandatory cloud service, and all config and credentials live in your local data directory.",
      points: [
        { title: "MIT licensed", body: "Use, modify and ship commercially — just keep the notice." },
        { title: "Local first", body: "SQLite holds accounts and settings; the proxy binds to loopback." },
        { title: "Three platforms", body: "Windows, macOS and Linux builds are produced and signed by CI." },
      ],
      primary: "View source on GitHub",
      secondary: "Report an issue",
      sponsor: "Sponsor the project",
    },

    download: {
      eyebrow: "Get started",
      title: "Install it, ship a request in five minutes",
      lead: "The desktop app is free and open source with auto updates. For a headless server, use the one-line installer for the standalone service.",
      primary: "Download desktop build",
      secondary: "Read the install guide",
      os: [
        { name: "Windows", format: "NSIS installer · .exe" },
        { name: "macOS", format: ".dmg / .app" },
        { name: "Linux", format: ".deb / .AppImage" },
      ],
      commandTitle: "One-line Linux server install",
      commandNote: "Replace 19527 with your port; the installer starts the service and prints its URL.",
      copy: "Copy command",
      copied: "Copied",
      note: "Desktop builds auto-update with minisign verification. All release assets and the updater manifest live on GitHub Releases.",
    },

    footer: {
      tagline: "One shell for every AI API. Open source, local first, cross platform.",
      columns: [
        {
          title: "Product",
          links: [
            { text: "Core features", to: "/features/vibe" },
            { text: "Platform matrix", to: "/guide/platform-support" },
            { text: "Protocol routing", to: "/guide/protocol-routing" },
            { text: "Usage and stats", to: "/guide/usage-stats" },
            { text: "Model connectivity", to: "/guide/model-test" },
            { text: "Relays", to: "/relay/" },
          ],
        },
        {
          title: "Tutorials",
          links: [
            { text: "Tutorial hub", to: "/tutorials/" },
            { text: "Your first request", to: "/tutorials/first-request" },
            { text: "Codex on a Chat relay", to: "/tutorials/codex-with-chat-relay" },
            { text: "A pool that never stalls", to: "/tutorials/failover-pool" },
            { text: "Usage and cost", to: "/tutorials/usage-and-cost" },
            { text: "Remote and team setup", to: "/tutorials/remote-and-team" },
          ],
        },
        {
          title: "Guide",
          links: [
            { text: "What is AI Switch", to: "/guide/introduction" },
            { text: "Installation", to: "/guide/installation" },
            { text: "Quick start", to: "/guide/quick-start" },
            { text: "Accounts and pool", to: "/guide/accounts" },
            { text: "Reliability", to: "/guide/reliability" },
            { text: "FAQ", to: "/faq" },
          ],
        },
        {
          title: "Deploy",
          links: [
            { text: "Desktop", to: "/deploy/desktop" },
            { text: "Web service", to: "/deploy/web-service" },
            { text: "Standalone server", to: "/deploy/standalone-server" },
            { text: "Docker", to: "/deploy/docker" },
            { text: "Remote and HTTPS", to: "/deploy/remote-access" },
          ],
        },
        {
          title: "Developers · Extending",
          links: [
            { text: "Architecture", to: "/dev/architecture" },
            { text: "Local setup", to: "/dev/local-setup" },
            { text: "Release process", to: "/dev/release" },
            { text: "Relay integration spec", to: "/relay/spec" },
            { text: "Source on GitHub", href: REPO },
            { text: "Open an issue", href: ISSUES },
          ],
        },
        {
          title: "Resources",
          links: [
            { text: "Downloads and changelog", href: RELEASES },
            { text: "Discussions", href: DISCUSSIONS },
            { text: "Sponsor", to: "/sponsor" },
            { text: "MIT license", href: `${REPO}/blob/main/LICENSE` },
          ],
        },
      ],
      built: "Released under the MIT License · Copyright © 2026 xyito",
      disclaimer: "The official site and docs of the open-source AI Switch project. Third-party product names belong to their respective owners.",
    },
  },
};
