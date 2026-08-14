# 安装指南

dsh-collaboration 由两类组件构成，分别装在 DeepSeek Harness 的两个平面上：

| 组件 | 平面 | 安装位置 |
|---|---|---|
| `@dsh-collaboration/llm-*` 三个适配器 | 宿主（host） | profile workspace + `cordis.patch.yml` |
| `@dsh-collaboration/team` 专家名册 | 宿主（host） | profile workspace + `cordis.patch.yml`；名册本体在 `settings.yaml` |
| `@dsh-collaboration/tool-*` 工具 | 代理（agent preset） | `collaboration` 预设行 |
| `collaboration` 预设（显示名：协同模式） | 代理 | `${DSH_HOME}/.agent-presets/collaboration/` |

## 前置条件

- DeepSeek Harness 已安装并可启动（本套件基于 `@deepseek-ai/dsh-*` 0.1.0-rc 系列 API）
- Node.js ≥ 20，pnpm ≥ 9

## 1. 安装包到 profile workspace

在 profile 目录（例如 `%USERPROFILE%\.dsh\profiles\web`）执行：

```powershell
pnpm add -w @dsh-collaboration/llm-openai-compatible @dsh-collaboration/llm-anthropic @dsh-collaboration/llm-gemini @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision
```

profile workspace 使用 `nodeLinker: hoisted`，包与其依赖会被提升到 profile 根 `node_modules`，宿主行与预设行都从这里解析。

## 2. 在 `cordis.patch.yml` 插入适配器行

编辑 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`：

```yaml
# dsh-collaboration: 外部模型适配器（宿主行；工具装在「协同模式」预设里）
- insert:
    - id: llm-openai-compatible
      name: '@dsh-collaboration/llm-openai-compatible'

    - id: llm-anthropic
      name: '@dsh-collaboration/llm-anthropic'

    - id: llm-gemini
      name: '@dsh-collaboration/llm-gemini'

    - id: collaboration-team
      name: '@dsh-collaboration/team'
```

不需要某个协议时删掉对应行即可（例如只用 OpenAI 系，就只留第一行）。

## 2.5 配置专家名册（settings.yaml）

`team` 行提供默认名册（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手 + 未配置的观察员/画家）。在 `settings.yaml` 的 `collaboration-team` 段整体替换，**改完即生效**：

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: 统筹全局、按需调用专家 }
    - { id: planner, name: 规划师, role: 拆解任务, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: looker, name: 观察员, role: 看图与 UI 分析, provider: zhipu, model: glm-4v-flash }
    - { id: painter, name: 画家, role: 图像创作, provider: openai, model: gpt-image-1 }
```

`provider`/`model` 留空 = 未配置（除 `main` 外，被 `team_call` 调用时工具会报出明确的配置提示）。

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

## 4. 安装「协同模式」预设（id: collaboration）

把本仓库的 `config/agent-presets/collaboration` 目录复制到用户预设根：

```powershell
Copy-Item -Recurse <repo>\config\agent-presets\collaboration "$env:USERPROFILE\.dsh\.agent-presets\collaboration"
```

（在 DSH 会话内也可以用 `agentPresets.copy` 从已装预设复制后手工加行；直接复制目录对本仓库最直接。）

## 5. 重启并验证

重启 DSH（改动在启动时生效）。验证：

1. 模型选择器中出现 `openai` / `moonshot` / `ollama` / `openrouter` / `siliconflow` / `groq` / `anthropic` / `gemini` 路由；
2. 新建会话选择「协同模式」预设，工具列表里出现 `team_call` / `roundtable` / `model_compare` / `vision`；
3. 若某工具的默认路由未装适配器，调用该工具时对应条目只报错，不影响其他条目。

## 6. 使用示例

在「协同模式」预设的会话里：

```
用 team_call 让 reviewer 审查我刚写的认证模块，指出安全风险。

把 docs/screenshot.png 交给 looker，让他描述这张 UI 截图里的布局和问题。

开个 roundtable（planner、reviewer、critic）评估"把单体服务拆成微服务"这个决定。

用 model_compare 对比 glm-4.5 和 glm-4-flash 对"如何给一个 npm 库设计插件机制"的回答。
```

## 故障排查

| 症状 | 处理 |
|---|---|
| 模型选择器里没有新路由 | 确认 patch 行已加且包已 `pnpm add` 进 profile；重启后看 `dsh --dump-config` 输出是否含对应行 |
| 调用时报 `MISSING_CREDENTIAL` | 对应环境变量未导出，或 `.credentials.yaml` 里没有该引用 |
| 调用时报 `NO_ADAPTER` | 工具配置里的路由名与安装的适配器路由不一致 |
| 视觉调用报 `UNSUPPORTED_CONTENT` / 图片未发出 | 目标模型未标 `vision: true`，或部署没有 attachments 服务 |
| 预设挂载报行未激活 | 见各包 README 的依赖清单；确认宿主装有 `subagents`/`llm`/`fs`/`attachments` 服务（标准部署都有） |
