# APLG 示例插件夹具

本目录是 `https://github.com/ai-switch/plugin-example` 在 commit
`c30cd40d8d6fafba15acbeb0b866f72fff0229c1` 的离线验收夹具。上游仓库仍以该提交为基线；
本夹具只在本地验证即将迁移的 `aplgVite`、`aplg validate --stage dist` 和 `aplg pack`
配置，不会修改或推送远程仓库。

保留的上游文件：`LICENSE`、`aplg.json`、`index.html`、`src/**` 和
`tests/analyze-text.test.mjs`。`vite.config.js` 与 `package.json` 是为本地双 tarball
验收准备的迁移版本；真正的远程迁移必须在两个 npm 包发布后再单独提交。
