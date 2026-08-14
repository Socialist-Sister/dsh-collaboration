# Changelog

本文件记录 dsh-collaboration 各版本的变更（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 精神）。

## [v0.1.2] - 2026-08-14

### 修复

- **`maxDepth` 默认值 0 → 1**：子代理深度从 1 起算，`maxDepth: 0` 会让主代理的 `team_call`/`roundtable` 全部被拒（`subagent depth 1 exceeds maxDepth 0`）。活体探针在真实重启后发现并修复；`1` 的语义为「专家可被召集、但不得再向下委派」。预设行同步改为 `maxDepth: 1`。
- 本次由真实端到端探针验证：spawn 子代理 + `agentOptions` 模型覆盖 + 真实 DeepSeek API 调用全链路通过。

## [v0.1.1] - 2026-08-14

### 变更

- **专家模型语义：留空 = 跟随主模型**。名册里未填 `provider`/`model` 的身份不再报"未配置"错误，而是跟随当前会话主模型（聊天框选择器）执行；想给某身份单独配模型时才在 `settings.yaml` 的 `collaboration-team` 段填上。名册因此零配置可用。
  - `@dsh-collaboration/team` 0.1.1：`configured()` 语义更新、注释更新。
  - `@dsh-collaboration/tool-team` 0.1.1：`team_call` 仅在身份钉住模型时下发 `agentOptions`；`roundtable` 默认召集全部非 main 身份；名册提示段对未钉模型的身份显示「跟随主模型」。
- 提示：视觉身份（观察员）建议在 settings.yaml 钉一个视觉模型（如 `zhipu/glm-4v-flash`），否则它会跟随纯文本主模型、看图时在运行时报错。

## [v0.1.0] - 2026-08-14（重新发布）

### 变更

- **彻底移除自带 LLM 适配器，改为对接官方模型体系**：删除 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个包。模型供应商一律由用户在官方「设置 → 模型 → 添加供应商」接入（OpenAI 兼容协议等），本套件的名册与工具只引用**已添加的路由**。此改动同时永久消除与内置 pi-ai 目录的路由冲突（不再注册任何 provider）。
- **CI 防回归检查**：新增 Guard 步骤，仓库内任何包出现 `registerAdapter` / `registerConfigurableProviders` 即失败，防止再次引入路由冲突。
- 文档全面改写为官方接入流程；删除适配器专用测试脚本（e2e-mock / e2e-adapters）。

## [v0.1.0-alpha] - 2026-08-14（已撤回的初版）

### 新增（历史记录）

- `@dsh-collaboration/team`（专家名册）、`@dsh-collaboration/tool-team`（team_call / roundtable）、`@dsh-collaboration/tool-model-compare`、`@dsh-collaboration/tool-vision`、`collaboration` 预设。
- 初版自带 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个适配器；因与新版 DSH 内置 pi-ai 目录路由冲突（DUPLICATE_DIRECTORY），在 v0.1.0 重发布时移除。适配器时期通过 mock 协议全链路断言与智谱 GLM 真实 API（含 glm-4v-flash 识图）验证过序列化/视觉编码等逻辑。
