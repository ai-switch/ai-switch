# Beta 更新频道设计

## 目标

开发者先通过应用内更新验证 RC，通过后再发布正式版本，让普通用户检测到更新。Beta 默认关闭，已有配置缺少 `beta_updates_enabled` 时仍按稳定频道检查。

本功能是**主动选择的预发布频道**，不是账号白名单或私密发布：任何主动开启 Beta 的客户端都能检测 RC，公开仓库里的预发布安装包也仍可手动下载。

## 端点与版本选择

- 稳定源：`https://github.com/ai-switch/ai-switch/releases/latest/download/latest.json`。
- Beta 源：`https://raw.githubusercontent.com/ai-switch/ai-switch/beta/beta.json`。
- Beta 关闭时只请求稳定源；开启时独立检查两个源，从插件判定为高于当前版本且支持当前平台的候选中，按 SemVer 取最高版本。同版本优先稳定源。
- 因此 `0.19.0-rc.1` 可以更新到 `0.19.0`，Beta 清单保留旧 RC 也不会阻止测试者收到后续正式版本。不会主动降级。
- 两个源独立检查，而不是使用插件的多 endpoint 回退：后者拿到第一个有效 JSON 就停止，会被陈旧 Beta 清单遮住更新的正式版。
- 一个源失败但另一个找到更新时，仍能提供该更新；没有任何候选且存在未检查成功的源时报告检查失败，不假称已经是最新。

## 持久化与桌面协议

`AppSettings` / `AppSettingsView` 增加默认 `false` 的 `beta_updates_enabled`，继续保存在 `~/.ai-switch/settings.json`，不增加数据库迁移。

Rust `check_update` 读取当前设置，调用 `tauri_plugin_updater::UpdaterExt`，分别建立相应端点的 updater，沿用既有公钥、平台识别和版本检查。所选 `Update` 注册到调用 webview 的资源表，返回与插件兼容的 camelCase 元数据。

前端通过 `new Update(metadata)` 继续使用插件的 `downloadAndInstall()`。签名验证、安装和重启路径不被重新实现。`check_update` 列为桌面专属命令，浏览器和独立服务器不提供应用自身的自动更新。

## 交互

更新页右侧提供 Beta 开关和实际使用的更新源。读取到完整设置后才显示可修改开关；保存时合并最新设置，失败显示原因。

保存成功后重新检查，立即移除旧频道候选。检查和安装期间禁用频道开关，防止混用两个频道的结果。全局自动提示收到频道变化通知后也重新检查，通过请求代号忽略旧频道的迟到结果。

候选被替换、用户关闭提示、页面卸载时释放 Tauri 更新资源；安装期间不由后台检查释放正在使用的资源。

## 发布侧

现有 `release.yml` 保持 tag 发布规则不变：带 `-rc` / `-beta` / `-alpha` 的版本为 GitHub prerelease，不成为稳定更新源的 latest。

安装包与 `latest.json` 完成发布后，仅预发布 tag 运行 `scripts/publish-beta-manifest.mjs`。它将同一份清单按原字节发布到专用 `beta` 分支的 `beta.json`，不把下载表混入更新日志。

脚本先校验 tag/清单版本一致、平台条目带签名且 URL 为 HTTPS；使用单独临时 Git 目录，不切换当前 main、不修改当前索引。首次创建单文件分支，后续只做 fast-forward。更新失败时重新拉取并比较版本；旧 RC 的重跑不能覆盖更新的 RC。错误只输出 warning，不把已经发布的 Release 标红。

正式版不更新 beta 分支，由测试客户端同时检查稳定源完成 RC → 正式版升级。凭据通过 Git 环境配置传递，不写进远端 URL 或日志。

## 操作顺序

1. 先安装一个包含本功能的版本；旧版没有 Beta 开关，首次接入需手动安装或通过正常正式版更新。
2. 仅在自己的测试设备上进入「更新」开启 Beta。
3. 按 AGENTS.md 完成版本同步、检查、双语 Release 提交与 annotated tag，发布例如 `v0.19.0-rc.1`。
4. 确认 RC 安装包和 beta 分支清单均成功发布；检查/下载/安装 RC。默认稳定频道的普通用户不会被提示这个 RC。
5. 验证通过后按同样流程发布 `v0.19.0`。必须同步应用版本，不能只把 RC 的 GitHub 标记改成正式版。

## 已知约束

- raw.githubusercontent.com 的缓存可能让新 RC 的提示延迟几分钟。
- 首次 RC 清单尚未发布或网络不通时，Beta 检查可能报告失败；关闭 Beta 后稳定检查不受影响。
- Beta 分支须允许工作流 `GITHUB_TOKEN` 写入。若组织策略或分支保护拒绝写入，查看 warning，修正后重跑相应 release job。
- 本轮实现与本地验证不创建远端 beta 分支、不发布任何版本、不真实安装更新。
