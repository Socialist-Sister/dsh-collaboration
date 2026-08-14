<!-- DIRECTION (approved in the planning conversation before any code was written):
  dsh-openagent is an independent third-party open-source monorepo for DeepSeek Harness.
  - Form: DSH-aligned multi-package monorepo (Plan A), published to npm under @dsh-openagent/*.
  - Key decisions:
      1. LLM adapters cover three protocols: OpenAI-compatible, Anthropic Messages, Google Gemini.
      2. Multi-agent collaboration ships as PURE TOOLS (expert roundtable, model compare, vision
         bridge) usable by the main agent — no Client/web UI in v0.1.
      3. Independent repo, no upstream merge requirement.
  - Why: DSH already exposes the llm adapter seam, the subagents registry, and the attachments
    service; row-based composition (profile workspace + cordis.patch.yml + agent presets) is the
    official third-party extension path, so this project plugs in without touching DSH internals.
-->

# dsh-openagent

DeepSeek Harness 多智能体协同套件 —— 让 DeepSeek 主代理外接别家模型、组建专家团队、并借助多模态模型补齐视觉能力。

受 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 的多智能体工作台理念启发，但以 DeepSeek Harness 的原生机制实现：**外部模型通过官方 `llm` 适配器接口接入，多智能体协同通过官方 `subagents` 注册表以工具形态交付**。

## 能力一览

| 能力 | 包 | 说明 |
|---|---|---|
| 外接 OpenAI 系模型 | `@dsh-openagent/llm-openai-compatible` | 一个适配器通吃 OpenAI / Moonshot / Ollama / OpenRouter / 硅基流动 / Groq / vLLM 等所有 `/v1/chat/completions` 端点，含 GPT-4o 视觉 |
| 外接 Claude | `@dsh-openagent/llm-anthropic` | Anthropic Messages API，含 Claude 视觉 |
| 外接 Gemini | `@dsh-openagent/llm-gemini` | Google Gemini API，顶级视觉能力 |
| 专家圆桌 | `@dsh-openagent/tool-roundtable` | 配置化专家模板（模型+人格+系统提示），并行发言 → 主持人综合 |
| 模型对比 | `@dsh-openagent/tool-model-compare` | 同一 prompt 并发发送多个模型，并排返回结果 |
| 多模态桥 | `@dsh-openagent/tool-vision` | DeepSeek 主代理把图片/截图交给视觉模型，拿回文字分析 |
| 一键预设 | `config/agent-presets/openagent` | standard 全量工具 + 上述三工具 |

## 仓库结构

```
packages/
  llm/llm-openai-compatible/    OpenAI 兼容协议适配器
  llm/llm-anthropic/            Anthropic Messages 适配器
  llm/llm-gemini/               Gemini 适配器
  tools/tool-roundtable/        专家圆桌工具
  tools/tool-model-compare/     同题多模型对比工具
  tools/tool-vision/            多模态桥工具
config/
  agent-presets/openagent/      开箱即用的代理预设
docs/                           安装、配置与使用文档
```

## 安装与使用

见 [docs/installation.md](docs/installation.md)（开发中）。核心步骤：

1. 在 DSH profile workspace 中安装适配器：`pnpm add -w @dsh-openagent/llm-openai-compatible @dsh-openagent/llm-anthropic @dsh-openagent/llm-gemini`
2. 在 `cordis.patch.yml` 中插入适配器行，重启 DSH
3. 在 DSH 设置面板中填写各服务商的 API key
4. 将 `config/agent-presets/openagent` 复制到 `${DSH_HOME}/.agent-presets/`，新会话选择 `openagent` 预设

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build
```

### 离线验证（无需任何外部 API 密钥）

```bash
node scripts/e2e-mock.mjs      # 本地 mock 服务验证三协议完整链路（序列化/SSE/usage/错误映射/视觉编码）
node scripts/e2e-tools.mjs     # 新进程内驱动三个工具包 apply()，复现预设挂载校验路径
```

有真实密钥时（可选项）：

```powershell
$env:OPENAI_API_KEY='sk-...'; $env:ANTHROPIC_API_KEY='sk-ant-...'; $env:GEMINI_API_KEY='AIza...'
node scripts/e2e-adapters.mjs  # 真实供应商调用 + 视觉调用
```

### 本地安装到 DSH（测试用）

```powershell
pnpm pack --dir packages/llm/llm-openai-compatible   # 其余包同理，tarball 收集到 dist/
# 在 profile workspace 里：
pnpm add -w <path-to>.tgz ...
```

## License

[MIT](LICENSE)
