# 锁文件夹具来源

`pnpm-lock.yaml` 原样取自已提交的 `https://github.com/ai-switch/plugin-example`：
commit `c30cd40d8d6fafba15acbeb0b866f72fff0229c1`，文件 `pnpm-lock.yaml`。

它证明测试使用真实 pnpm 锁文件字节，而非手工拼出的占位 YAML；仅用于 D1 文件存在/UTF-8/有界读取校验。
`validProjectFiles()` 的 package.json 含 runtime/devkit 开发依赖，与这份原始示例锁文件并不匹配，**不能**作为冻结安装成功的证明。
实际安装/构建与后续 D8 验收必须在消费者中生成匹配其真实 tarball 依赖的锁文件，再执行冻结安装。
