# 安装指南

dsh-openagent 由两类组件构成，分别装在 DeepSeek Harness 的两个平面上：

| 组件 | 平面 | 安装位置 |
|---|---|---|
| `@dsh-openagent/llm-*` 三个适配器 | 宿主（host） | profile workspace + `cordis.patch.yml` |
| `@dsh-openagent/tool-*` 三个工具 | 代理（agent preset） | `openagent` 预设行 |
| `openagent` 预设 | 代理 | `${DSH_HOME}/.agent-presets/openagent/` |

## 前置条件

- DeepSeek Harness 已安装并可启动（本套件基于 `@deepseek-ai/dsh-*` 0.1.0-rc 系列 API）
- Node.js ≥ 20，pnpm ≥ 9

## 1. 安装包到 profile workspace

在 profile 目录（例如 `%USERPROFILE%\.dsh\profiles\web`）执行：

```powershell
pnpm add -w @dsh-openagent/llm-openai-compatible @dsh-openagent/llm-anthropic @dsh-openagent/llm-gemini @dsh-openagent/tool-roundtable @dsh-openagent/tool-model-compare @dsh-openagent/tool-vision
```

profile workspace 使用 `nodeLinker: hoisted`，包与其依赖会被提升到 profile 根 `node_modules`，宿主行与预设行都从这里解析。

## 2. 在 `cordis.patch.yml` 插入适配器行

编辑 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`：

```yaml
# dsh-openagent: 外部模型适配器（宿主行；工具装在 openagent 预设里）
- insert:
    - id: llm-openai-compatible
      name: '@dsh-openagent/llm-openai-compatible'

    - id: llm-anthropic
      name: '@dsh-openagent/llm-anthropic'

    - id: llm-gemini
      name: '@dsh-openagent/llm-gemini'
```

不需要某个协议时删掉对应行即可（例如只用 OpenAI 系，就只留第一行）。

## 3. 配置 API 密钥

三个适配器按需读取下列环境变量（在启动 DSH 的环境中导出，或写入 `%USERPROFILE%\.dsh\.credentials.yaml`）：

| 路由 | 环境变量 |
|---|---|
| `openai` / `moonshot` / `openrouter` / `siliconflow` / `groq` | `OPENAI_API_KEY` / `MOONSHOT_API_KEY` / `OPENROUTER_API_KEY` / `SILICONFLOW_API_KEY` / `GROQ_API_KEY` |
| `zhipu`（智谱 GLM，含 GLM-4.5V / GLM-4V 视觉） | `ZHIPUAI_API_KEY` |
| `ollama` | 无需密钥 |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |

细调（端点、模型目录、启用开关）写在 `settings.yaml` 的 `llm-openai` / `llm-anthropic` / `llm-gemini` 段，见各包 README。

## 4. 安装 `openagent` 预设

把本仓库的 `config/agent-presets/openagent` 目录复制到用户预设根：

```powershell
Copy-Item -Recurse <repo>\config\agent-presets\openagent "$env:USERPROFILE\.dsh\.agent-presets\openagent"
```

（在 DSH 会话内也可以用 `agentPresets.copy` 从已装预设复制后手工加行；直接复制目录对本仓库最直接。）

## 5. 重启并验证

重启 DSH（改动在启动时生效）。验证：

1. 模型选择器中出现 `openai` / `moonshot` / `ollama` / `openrouter` / `siliconflow` / `groq` / `anthropic` / `gemini` 路由；
2. 新建会话选择 `openagent` 预设，工具列表里出现 `roundtable` / `model_compare` / `vision`；
3. 若某工具的默认路由未装适配器，调用该工具时对应条目只报错，不影响其他条目。

## 6. 使用示例

在 `openagent` 预设的会话里：

```
用 roundtable 评估"把单体服务拆成微服务"这个决定，
专家用 architect（deepseek-v4-pro）和 security（claude-sonnet-4），
最后给我一个综合结论。

用 model_compare 对比 gpt-4o、claude-sonnet-4、gemini-2.5-flash
对"如何给一个 npm 库设计插件机制"的回答。

把 docs/screenshot.png 交给 vision：帮我描述这张 UI 截图里的布局和问题。
```

## 故障排查

| 症状 | 处理 |
|---|---|
| 模型选择器里没有新路由 | 确认 patch 行已加且包已 `pnpm add` 进 profile；重启后看 `dsh --dump-config` 输出是否含对应行 |
| 调用时报 `MISSING_CREDENTIAL` | 对应环境变量未导出，或 `.credentials.yaml` 里没有该引用 |
| 调用时报 `NO_ADAPTER` | 工具配置里的路由名与安装的适配器路由不一致 |
| 视觉调用报 `UNSUPPORTED_CONTENT` / 图片未发出 | 目标模型未标 `vision: true`，或部署没有 attachments 服务 |
| 预设挂载报行未激活 | 见各包 README 的依赖清单；确认宿主装有 `subagents`/`llm`/`fs`/`attachments` 服务（标准部署都有） |
