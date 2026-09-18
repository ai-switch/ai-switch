# __APLG_NAME_TEXT__

这是一个最小的 APLG `vanilla-ts` 插件项目。

- 插件 ID：`__APLG_ID_TEXT__`
- 默认权限：无文件系统、网络或原生权限
- 项目是 `private: true`，不是要发布到 npm 的公共库

## 第一次运行

初始化器不会生成虚假的 `pnpm-lock.yaml`。在提交项目之前，先执行：

```sh
pnpm install
pnpm test:node
pnpm build
pnpm plugin:validate
pnpm plugin:pack
```

请把与实际依赖和版本匹配的 `pnpm-lock.yaml` 提交到自己的 GitHub 仓库，然后让 CI 使用冻结安装。

## 权限边界

`@ai-switch/tauri-plugin-runtime` 的文件系统、存储和其他能力由宿主协商与授权。模板本身不会获得操作系统权限；在 `aplg.json` 中声明权限也不等于宿主一定会授予权限。

## 提交到 plugin-store

插件源码保留在作者自己的公开 GitHub 仓库。向 [ai-switch/plugin-store](https://github.com/ai-switch/plugin-store) 提交发布申请 PR 时，请固定源码 commit，记录 `aplg.json` 的 SHA-256，并按商店的维护者核验和 CI 流程提交；不要在仓库或 PR 中写入发布密钥。

## 目录

- `src/main.ts`：浏览器入口；构建时由 `aplgVite` 注入握手启动器
- `src/example.js`：可独立测试的纯逻辑示例
- `vite.config.ts`：仅用于该插件项目的 Vite 配置
- `aplg.json`：插件清单
