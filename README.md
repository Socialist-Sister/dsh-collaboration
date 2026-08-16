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

<kbd>team</kbd> <kbd>tool-team</kbd> <kbd>tool-model-compare</kbd> <kbd>tool-vision</kbd> <kbd>tool-image-inbox</kbd>

</div>

---

## Contents

- [What is this](#what-is-this)
- [Features](#features)
- [How it works](#how-it-works)
- [Team topology](#team-topology)
- [Images with a text-only main agent](#images-with-a-text-only-main-agent)
- [The specialist roster](#the-specialist-roster)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Roster configuration](#roster-configuration)
- [Usage examples](#usage-examples)
- [Development](#development)
- [License](#license)

## What is this

Inspired by the multi-agent workbench idea of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), rebuilt on DeepSeek Harness native mechanisms:

- **Model providers are connected through the official Settings → Models → "Add provider" flow** (this suite bundles NO model adapters — zero conflict with the official catalog);
- **This suite organizes the team**: specialist roster, on-demand dispatch, roundtable review, model comparison, and a multimodal vision bridge.

## Features

| Feature | Package | Notes |
|---|---|---|
| Specialist roster | `@dsh-collaboration/team` | Ten pre-defined identities (main/planner/coder/debugger/reviewer/researcher/critic/writer/looker/painter), each with a duty; per-identity models configured in `settings.yaml`, applied **live**; empty = follow the session model. Identities are templates that can be hired as PERSISTENT specialist instances (with clones). v0.4: the child-scoped `team_help` tool lets a specialist ask another specialist for help through the main agent |
| Team console | `@dsh-collaboration/tool-team` | `team_call` hires persistent specialists (`instances` clones one identity, `tasks` gives each clone its own task); `team_message` follow-ups/relays (star topology, v0.4 relay routing); `team_status` live board; `team_close` dismisses; `roundtable` one-shot parallel panel |
| Model comparison | `@dsh-collaboration/tool-model-compare` | One prompt to several models in parallel, answers side by side |
| Vision bridge | `@dsh-collaboration/tool-vision` | A text-only main agent sends images to a vision-capable model and works from the text analysis |
| Image inbox | `@dsh-collaboration/tool-image-inbox` | An invisible paste bridge: pasting an image in a collaboration session stores it as a workspace file and puts the path in the draft — no button, works for text-only main agents, routed to looker/vision |
| One-line preset | `config/agent-presets/collaboration` | Full `standard` toolset + the tools above (display name: 协同模式 / Collaboration Mode) |

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
  ├─ team_message  → follow up or relay to any instance (specialists ask each other via team_help, you relay)
  ├─ team_status   → live team board; team_close → dismiss an instance
  ├─ model_compare → same prompt across models, side by side
  └─ vision        → images to a vision model → text analysis back
```

## Team topology

Every identity can be hired multiple times as separate instances (`reviewer#1`, `reviewer#2`, …). The main agent is the star hub — all traffic flows through it.

```
                     ┌─────────────────────┐
                     │   Main agent (you)  │
                     │     the star hub    │
                     └──────────┬──────────┘
        team_call hires  ·  team_message relays (both directions)
     ┌──────────────┬────────────┼────────────┬──────────────┐
     ▼              ▼            ▼            ▼              ▼
 planner#1      coder#1      looker#1      writer#1      reviewer#2   …
     │              │            │            │              │
     └───────────── report / settlement notices ────────────┘
```

Specialists never talk to each other directly. When one needs another — for example `researcher` asking `looker` to read an image — the request circles through the main agent:

```
researcher#1 ── team_help ──►  main agent receives [team-relay]
      ▲                             │
      │                             ▼  team_message → looker#1
      │                             │
      └──── team_message ◄────  looker#1 reports the answer
```

## Images with a text-only main agent

The composer's image-attachment path is gated by the current model's `inputModalities`: DeepSeek text-only routes declare no `image` modality, so pasted images are rejected at admission — `looker` or not. `tool-image-inbox` solves this INSIDE the policy, with a paste-as-usual experience:

```
Paste an image in a collaboration session
  → an invisible client bridge intercepts the paste (no button, no UI)
  → the image is stored as a workspace file (.dsh-inbox/)
  → "[图片: <path>]" appears in the draft; press Enter
  → the main agent routes the path to the vision tool or hires looker
  → looker configured: normal image analysis; not configured: the agent hints how to set it up
```

Non-collaboration sessions and text-only pastes are untouched. Alternatives: drop the image into the workspace folder and name the path, or switch the session to a vision route (e.g. `zai` / `glm-5v-turbo`) and paste natively.

## The specialist roster

Ten pre-defined identities, each with its own specialty. The tool surface is tiered by duty: research-type identities get read-only tools, execution identities get shell/file/skill tools, visual identities get read + vision.

| id | Name | Specialty | Tool surface |
|---|---|---|---|
| `main` | 主代理 (Main agent) | Coordinates the whole effort: first analyzes the task structure and clarifies the division of labor, then dispatches via `team_call`; integrates specialist reports and makes the final call — never executes specialists' core work itself | Full session toolset (never hired as an instance) |
| `planner` | 规划师 (Planner) | Splits complex goals into steps and milestones with dependencies, ordering, and acceptance criteria | Read-only: read/glob/grep/web_search |
| `coder` | 工程师 (Engineer) | Writes production code, lands features, fixes defects; follows the project's existing style and conventions | Execution: pwsh/read/write/edit/glob/grep/web_search/skill/todo_write |
| `debugger` | 调试员 (Debugger) | Hunts bugs: reads errors and logs, produces minimal reproductions and fix plans | Execution: pwsh/read/glob/grep/edit |
| `reviewer` | 审查员 (Reviewer) | Reviews code and designs for security holes, edge cases, performance, and maintainability risks | Read-only: read/glob/grep/web_search |
| `researcher` | 研究员 (Researcher) | Researches technology, competitors, and facts; cites sources in its conclusions | Read-only: read/glob/grep/web_search |
| `critic` | 评论家 (Critic) | Challenges assumptions, hunts blind spots, plays devil's advocate — hardens the plan before it ships | Read-only: read/glob/grep/web_search |
| `writer` | 写手 (Writer) | Writes docs, reports, READMEs, and copy — precise language, clear structure | Execution: read/write/edit/glob/grep |
| `looker` | 观察员 (Looker) | Multimodal analysis of images, screenshots, and UIs: describes layouts, extracts text, spots visual issues | Visual: read/read_image/vision |
| `painter` | 画家 (Painter) | Image creation and generation: turns a description into visual assets or concepts | Visual: read/vision |

## Repository layout

```
packages/
  host/team/                     Specialist roster (settings.yaml-configurable)
  tools/tool-team/               team_call dispatch + roundtable
  tools/tool-model-compare/      Same-prompt model comparison
  tools/tool-vision/             Multimodal vision bridge
  tools/tool-image-inbox/        Invisible image-paste bridge for text-only mains
config/
  agent-presets/collaboration/   Ready-to-use agent preset
docs/                            Installation & usage guide
scripts/                         Validation scripts
```

## Quick start

> Full guide: [docs/installation.md](docs/installation.md).

1. **Install the five packages** into the DSH profile workspace:

   ```powershell
   pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision @dsh-collaboration/tool-image-inbox
   ```

   > Before npm publication, grab the `.tgz` assets from [Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases).

2. **Insert the host rows** (`cordis.patch.yml`):

   ```yaml
   - insert:
       - id: collaboration-team
         name: '@dsh-collaboration/team'
       - id: collaboration-image-inbox
         name: '@dsh-collaboration/tool-image-inbox'
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

| Scenario | What the main agent does |
|---|---|
| Parallel audits | `team_call` with `instances: 2` hires two `reviewer` clones, one per module |
| Follow-up question | `team_message` to `reviewer#1` about session-fixation attacks |
| Relay an objection | `team_message` critic's objection to `planner` |
| Specialist asks specialist | `researcher` calls `team_help` for `looker`; you forward the request and relay the answer back |
| Group deliberation | `roundtable` with `planner`, `reviewer`, `critic` on one topic |
| Model comparison | `model_compare` deepseek-v4-pro vs zhipu/glm-4.5 on the same prompt |
| Read an image | `vision` sends a screenshot to the vision model and returns text analysis |

## Development

```bash
pnpm install      # install dependencies
pnpm typecheck    # typecheck all packages
pnpm build        # build
```

### Validation

```bash
node scripts/e2e-tools.mjs     # drives each tool package's apply() in a fresh process (mirrors preset mount checks)
node scripts/e2e-team-host.mjs # drives the team host service: instance lifecycle + team_help relay
node scripts/check-roster.mjs  # validates the collaboration-team roster in settings.yaml
```

---

<div align="center">

**[MIT](LICENSE)** · **[Repository](https://github.com/Socialist-Sister/dsh-collaboration)** · **[Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases)**

</div>
