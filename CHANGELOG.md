# Changelog

本文件记录 dsh-collaboration 各版本的变更（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 精神，自 v0.1.0 起）。

## [Unreleased]

### 变更

- **彻底移除自带 LLM 适配器，改为对接官方模型体系**：删除 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个包。模型供应商一律由用户在官方「设置 → 模型 → 添加供应商」接入（OpenAI 兼容协议等），本套件的名册与工具只引用**已添加的路由**。此改动同时永久消除与内置 pi-ai 目录的路由冲突（不再注册任何 provider）。
- **CI 防回归检查**：新增 Guard 步骤，仓库内任何包出现 `registerAdapter` / `registerConfigurableProviders` 即失败，防止再次引入路由冲突。
- 文档全面改写为官方接入流程；删除适配器专用测试脚本（e2e-mock / e2e-adapters）。

## [v0.1.0] - 2026-08-14

首个公开版本。为 DeepSeek Harness 提供多智能体协同能力：

### 新增

- **`@dsh-collaboration/team`** — 专家名册宿主包：`collaboration-team` settings 命名空间 + `collaborationTeam` 服务。默认十身份（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手/观察员/画家），每身份的模型由用户在 `settings.yaml` 自行配置，改完即生效；观察员/画家默认留空待配。
- **`@dsh-collaboration/tool-team`** — `team_call`（点名单个专项专家，以其人设+其模型作为子代理执行）+ `roundtable`（并行召集多位专家发言，主代理主持综合）；名册以系统提示段实时展示给主代理。
- **`@dsh-collaboration/llm-openai-compatible`** — OpenAI 兼容协议适配器，内置路由：openai / moonshot / ollama / openrouter / siliconflow / zhipu（智谱 GLM）/ groq，支持视觉模型的 `image_url` 编码。
- **`@dsh-collaboration/llm-anthropic`** — Anthropic Messages API 适配器（Claude 全系，含视觉）。
- **`@dsh-collaboration/llm-gemini`** — Google Gemini API 适配器（多模态）。
- **`@dsh-collaboration/tool-model-compare`** — 同题多模型对比工具。
- **`@dsh-collaboration/tool-vision`** — 多模态桥工具：纯文本主代理把图片交给视觉模型，拿回文字分析。
- **`collaboration` 代理预设**（显示名：协同模式）— standard 全量工具 + 上述工具。

### 验证

- 三协议适配器通过本地 mock 供应商服务器的全链路断言（鉴权、序列化、SSE、usage/错误映射、视觉编码）；
- 智谱 GLM 真实 API 端到端测试通过（文本 + glm-4v-flash 多模态识图）；
- 工具包通过新进程 apply() 校验（参数 DSL、守卫、名册提示段）；
- GitHub Actions CI 全绿（typecheck + build）。
