# Changelog

本文件记录 dsh-collaboration 各版本的变更（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 精神，自 v0.1.0 起）。

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
