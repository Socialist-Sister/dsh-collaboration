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

**Multi-Agent Collaboration Suite for DeepSeek Harness**

A user-configured roster of specialists with on-demand dispatch — models come from the official provider flow, teamwork comes from here.

[English](README.md) · [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Socialist-Sister/dsh-collaboration)](https://github.com/Socialist-Sister/dsh-collaboration/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Socialist-Sister/dsh-collaboration/ci.yml?branch=main)](https://github.com/Socialist-Sister/dsh-collaboration/actions)

</div>

## What is this

Inspired by the multi-agent workbench idea of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), rebuilt on DeepSeek Harness native mechanisms:

- **Model providers are connected through the official Settings → Models → "Add provider" flow** (this suite bundles NO model adapters — zero conflict with the official catalog);
- **This suite organizes the team**: specialist roster, on-demand dispatch, roundtable review, model comparison, and a multimodal vision bridge.

## Features

| Feature | Package | Notes |
|---|---|---|
| 🧑‍🤝‍🧑 Specialist roster | `@dsh-collaboration/team` | Ten pre-defined identities (main/planner/coder/debugger/reviewer/researcher/critic/writer/looker/painter), each with a duty; per-identity models configured in `settings.yaml`, applied **live**; empty = follow the session model. Since v0.2 identities are templates that can be hired as PERSISTENT specialist instances (with clones) |
| 🎯 Team console | `@dsh-collaboration/tool-team` | `team_call` hires persistent specialists (`instances` clones one identity, `tasks` gives each clone its own task); `team_message` follow-ups/relays (star topology); `team_status` live board; `team_close` dismisses; `roundtable` one-shot parallel panel |
| ⚖️ Model comparison | `@dsh-collaboration/tool-model-compare` | One prompt to several models in parallel, answers side by side |
| 👁️ Vision bridge | `@dsh-collaboration/tool-vision` | A text-only main agent sends images to a vision-capable model and works from the text analysis |
| 🎁 One-line preset | `config/agent-presets/collaboration` | Full `standard` toolset + the tools above (display name: 协同模式 / Collaboration Mode) |

## How it works

```
Official Settings → Models: deepseek-official + user-added providers (OpenAI-compatible, …)
        │  registered routes
        ▼
collaboration-team roster (settings.yaml)  ←──  each identity: duty + optional model
        │  host service collaborationTeam
        ▼
Main agent (Collaboration preset)
  ├─ team_call     → hire persistent specialist instances (with clones) → report / settlement notices
  ├─ team_message  → follow up or relay to any instance (specialist-to-specialist goes through you)
  ├─ team_status   → live team board; team_close → dismiss an instance
  ├─ model_compare → same prompt across models, side by side
  └─ vision        → images to a vision model → text analysis back
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
Hire two reviewer clones to audit the auth module and the payments module.
Follow up with team_message: ask reviewer#1 about session-fixation attacks.
Relay critic's objection to planner via team_message.
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

## License

[MIT](LICENSE)
