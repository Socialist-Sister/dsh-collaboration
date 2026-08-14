<!-- DIRECTION (approved in the planning conversation before any code was written):
  dsh-collaboration is an independent third-party open-source monorepo for DeepSeek Harness.
  - Form: DSH-aligned multi-package monorepo, published to npm under @dsh-collaboration/*.
  - Key decisions:
      1. NO bundled LLM adapters: model providers are connected through the OFFICIAL
         Settings > Models > "Add provider" flow (the built-in pi-ai catalog). This
         project only consumes already-registered routes.
      2. Multi-agent collaboration ships as PURE TOOLS: a user-configured specialist
         roster (team_call / roundtable), model comparison, and a multimodal vision
         bridge — usable by the main agent.
      3. Independent repo, no upstream merge requirement.
  - Why: DSH already exposes the llm adapter seam and an official add-provider UI;
    registering provider routes from a third-party package collides with the built-in
    catalog (DUPLICATE_DIRECTORY) and clutters the model selector. Row-based composition
    (profile workspace + cordis.patch.yml + agent presets) is the official third-party
    extension path, so this project plugs in without touching DSH internals.
-->

<div align="center">

# dsh-collaboration

**DeepSeek Harness 多智能体协同套件 · Multi-Agent Collaboration Suite for DeepSeek Harness**

预设一组各司其职的专家身份，主代理按需点名调用 —— 模型走官方体系，团队交给本套件。

A user-configured roster of specialists with on-demand dispatch — models come from the official provider flow, teamwork comes from here.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Socialist-Sister/dsh-collaboration)](https://github.com/Socialist-Sister/dsh-collaboration/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Socialist-Sister/dsh-collaboration/ci.yml?branch=main)](https://github.com/Socialist-Sister/dsh-collaboration/actions)

</div>

---

## 目录 · Table of Contents

- [中文](#中文)
- [English](#english)

---

# 中文

## 这是什么

受 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 多智能体工作台理念启发，但以 DeepSeek Harness 原生机制实现：

- **模型供应商由用户在官方「设置 → 模型 → 添加供应商」接入**（本套件不捆绑任何模型适配器，与官方目录零冲突）；
- **套件负责把团队组织起来**：专家名册、按需点名、圆桌评审、模型对比、多模态桥。

## 能力一览

| 能力 | 包 | 说明 |
|---|---|---|
| 🧑‍🤝‍🧑 专家名册 | `@dsh-collaboration/team` | 预设十身份（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手/观察员/画家），各司其职；每个身份的模型在 `settings.yaml` 自行配置，**改完即生效**；留空 = 跟随主模型 |
| 🎯 按需点名 | `@dsh-collaboration/tool-team` | `team_call` 点名单个专家（以其人设+其模型作为子代理执行）；`roundtable` 并行召集多位专家；名册实时展示给主代理 |
| ⚖️ 模型对比 | `@dsh-collaboration/tool-model-compare` | 同一 prompt 并发发送多个模型，答案并排返回 |
| 👁️ 多模态桥 | `@dsh-collaboration/tool-vision` | 纯文本主代理把图片/截图交给视觉模型，拿回文字分析 |
| 🎁 一键预设 | `config/agent-presets/collaboration` | standard 全量工具 + 上述工具（显示名：**协同模式**） |

## 工作原理

```
官方「设置 → 模型」：deepseek-official + 用户添加的供应商（OpenAI 兼容协议等）
        │  已注册路由
        ▼
collaboration-team 名册（settings.yaml）   ←── 每个身份：人设 + 可选模型
        │  宿主服务 collaborationTeam
        ▼
主代理（协同模式预设）
  ├─ team_call   → 点名专家 → 子代理（该身份人设 + 该身份模型）→ 结论回传
  ├─ roundtable  → 多位专家并行发言 → 主代理主持综合
  ├─ model_compare → 多模型同题并发对比
  └─ vision      → 图片交给视觉模型 → 文字分析回传
```

## 仓库结构

```
packages/
  host/team/                     专家名册（settings.yaml 可配置）
  tools/tool-team/               team_call 点名 + roundtable 圆桌
  tools/tool-model-compare/      同题多模型对比
  tools/tool-vision/             多模态桥
config/
  agent-presets/collaboration/   开箱即用的代理预设（协同模式）
docs/                            安装、配置与使用文档
scripts/                         验证脚本（含 CI 防回归 Guard 配套）
```

## 快速开始

> 详细步骤见 [docs/installation.md](docs/installation.md)。

1. **安装四个包**到 DSH profile workspace：

   ```powershell
   pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision
   ```

   > 未发布到 npm 前，可从 [Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases) 下载 `.tgz` 附件安装。

2. **插入名册宿主行**（`cordis.patch.yml`）：

   ```yaml
   - insert:
       - id: collaboration-team
         name: '@dsh-collaboration/team'
   ```

3. **添加模型供应商**：官方「设置 → 模型 → 添加供应商」接入各家（示例见下表）。

   | 供应商 | 供应商 ID | 端点 | 协议 |
   |---|---|---|---|
   | 智谱 GLM | `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 |
   | OpenAI | `openai` | `https://api.openai.com/v1` | OpenAI 兼容 |
   | Moonshot | `moonshot` | `https://api.moonshot.cn/v1` | OpenAI 兼容 |
   | OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | OpenAI 兼容 |
   | 硅基流动 | `siliconflow` | `https://api.siliconflow.cn/v1` | OpenAI 兼容 |

4. **配置名册 + 预设**：`settings.yaml` 的 `collaboration-team` 段（示例见下）；复制 `config/agent-presets/collaboration` 到 `~/.dsh/.agent-presets/`。

5. **重启 DSH** → 新会话选择「协同模式」→ 开始使用。

## 配置专家名册

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: 统筹全局、按需调用专家 }
    - { id: planner, name: 规划师, role: 拆解任务, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: reviewer, name: 审查员, role: 审查代码与方案, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: looker, name: 观察员, role: 看图与 UI 分析, provider: zhipu, model: glm-4v-flash }
```

- `provider` 填官方已添加的供应商 ID；**留空 = 跟随主模型**（聊天框选择器）
- 视觉身份（观察员）建议配支持视觉的模型，否则看图时报运行错误
- 改动实时生效，无需重启

## 使用示例

```
用 team_call 让 reviewer 审查我刚写的认证模块，指出安全风险。
把 docs/screenshot.png 交给 looker，让他描述这张 UI 截图里的布局和问题。
开个 roundtable（planner、reviewer、critic）评估"把单体服务拆成微服务"这个决定。
用 model_compare 对比 deepseek-v4-pro 和 zhipu/glm-4.5 对同一问题的回答。
```

## 开发

```bash
pnpm install      # 安装依赖
pnpm typecheck    # 全包类型检查
pnpm build        # 构建
```

### 验证

```bash
node scripts/e2e-tools.mjs     # 新进程驱动工具包 apply()，复现预设挂载校验
node scripts/check-roster.mjs  # 校验 settings.yaml 的 collaboration-team 名册
```

### CI 防回归

CI 含 Guard 步骤：仓库内任何包出现 `registerAdapter` / `registerConfigurableProviders` 即失败——本项目**禁止捆绑模型适配器**，防止与官方目录路由冲突（历史教训见 [FIX-SUMMARY-LLM-PI-AI-CONFLICT.md](FIX-SUMMARY-LLM-PI-AI-CONFLICT.md)）。

## License

[MIT](LICENSE)

---

# English

## What is this

Inspired by the multi-agent workbench idea of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), rebuilt on DeepSeek Harness native mechanisms:

- **Model providers are connected through the official Settings → Models → "Add provider" flow** (this suite bundles NO model adapters — zero conflict with the official catalog);
- **This suite organizes the team**: specialist roster, on-demand dispatch, roundtable review, model comparison, and a multimodal vision bridge.

## Features

| Feature | Package | Notes |
|---|---|---|
| 🧑‍🤝‍🧑 Specialist roster | `@dsh-collaboration/team` | Ten pre-defined identities (main/planner/coder/debugger/reviewer/researcher/critic/writer/looker/painter), each with a duty; per-identity models configured in `settings.yaml`, applied **live**; empty = follow the session model |
| 🎯 On-demand dispatch | `@dsh-collaboration/tool-team` | `team_call` sends one named specialist a task (runs as a subagent with its persona and model); `roundtable` convenes several in parallel; the roster is surfaced to the main agent in its system prompt |
| ⚖️ Model comparison | `@dsh-collaboration/tool-model-compare` | One prompt to several models in parallel, answers side by side |
| 👁️ Vision bridge | `@dsh-collaboration/tool-vision` | A text-only main agent sends images to a vision-capable model and works from the text analysis |
| 🎁 One-line preset | `config/agent-presets/collaboration` | Full `standard` toolset + the tools above (display name: **协同模式 / Collaboration Mode**) |

## How it works

```
Official Settings → Models: deepseek-official + user-added providers (OpenAI-compatible, …)
        │  registered routes
        ▼
collaboration-team roster (settings.yaml)  ←──  each identity: duty + optional model
        │  host service collaborationTeam
        ▼
Main agent (Collaboration preset)
  ├─ team_call    → name one specialist → subagent (its persona + its model) → answer back
  ├─ roundtable   → several specialists in parallel → main agent chairs the synthesis
  ├─ model_compare → same prompt across models, side by side
  └─ vision       → images to a vision model → text analysis back
```

## Repository layout

```
packages/
  host/team/                     Specialist roster (settings.yaml-configurable)
  tools/tool-team/               team_call dispatch + roundtable
  tools/tool-model-compare/      Same-prompt model comparison
  tools/tool-vision/             Multimodal vision bridge
config/
  agent-presets/collaboration/   Ready-to-use agent preset
docs/                            Installation & usage guide
scripts/                         Validation scripts
```

## Quick start

> Full guide: [docs/installation.md](docs/installation.md).

1. **Install the four packages** into the DSH profile workspace:

   ```powershell
   pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision
   ```

   > Before npm publication, grab the `.tgz` assets from [Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases).

2. **Insert the roster host row** (`cordis.patch.yml`):

   ```yaml
   - insert:
       - id: collaboration-team
         name: '@dsh-collaboration/team'
   ```

3. **Add model providers** via the official Settings → Models → Add provider card:

   | Provider | Provider ID | Endpoint | Protocol |
   |---|---|---|---|
   | Zhipu GLM | `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI-compatible |
   | OpenAI | `openai` | `https://api.openai.com/v1` | OpenAI-compatible |
   | Moonshot | `moonshot` | `https://api.moonshot.cn/v1` | OpenAI-compatible |
   | OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | OpenAI-compatible |
   | SiliconFlow | `siliconflow` | `https://api.siliconflow.cn/v1` | OpenAI-compatible |

4. **Configure the roster + preset**: `collaboration-team` section in `settings.yaml` (see below); copy `config/agent-presets/collaboration` into `~/.dsh/.agent-presets/`.

5. **Restart DSH** → start a new conversation on the Collaboration preset → done.

## Roster configuration

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: Coordinates and dispatches specialists }
    - { id: planner, name: 规划师, role: Breaks goals into steps, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: reviewer, name: 审查员, role: Reviews code and designs, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: looker, name: 观察员, role: Vision analysis, provider: zhipu, model: glm-4v-flash }
```

- `provider` = a provider ID added in the official Models page; **empty = follow the session model** (chat-box selector)
- Give vision identities (e.g. `looker`) a vision-capable model, or image tasks fail at runtime
- Changes apply live — no restart needed

## Usage examples

```
Use team_call to have reviewer audit my auth module and flag security risks.
Send docs/screenshot.png to looker and describe the UI issues.
Run a roundtable (planner, reviewer, critic) on "should we split the monolith".
Compare deepseek-v4-pro and zhipu/glm-4.5 on the same prompt with model_compare.
```

## Development

```bash
pnpm install      # install dependencies
pnpm typecheck    # typecheck all packages
pnpm build        # build
```

### Validation

```bash
node scripts/e2e-tools.mjs     # drives each tool package's apply() in a fresh process (mirrors preset mount checks)
node scripts/check-roster.mjs  # validates the collaboration-team roster in settings.yaml
```

### CI guard

CI fails if any package calls `registerAdapter` / `registerConfigurableProviders` — this project must never bundle model adapters (route conflicts with the official catalog; history in [FIX-SUMMARY-LLM-PI-AI-CONFLICT.md](FIX-SUMMARY-LLM-PI-AI-CONFLICT.md)).

## License

[MIT](LICENSE)
