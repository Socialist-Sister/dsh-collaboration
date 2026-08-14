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

# dsh-collaboration

DeepSeek Harness 多智能体协同套件 —— 预设一组各司其职的专家身份，主代理按需点名调用；模型全部走 DSH 官方模型体系，不另起炉灶。

受 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 的多智能体工作台理念启发，但以 DeepSeek Harness 的原生机制实现：**模型供应商由用户在官方「设置 → 模型 → 添加供应商」接入，本套件只负责把团队组织起来**（专家名册 + 按需点名 + 圆桌 + 模型对比 + 多模态桥）。

## 能力一览

| 能力 | 包 | 说明 |
|---|---|---|
| 专家名册 | `@dsh-collaboration/team` | 预设一组各司其职的身份（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手/观察员/画家），每个身份的模型在 `settings.yaml` 里配置，改完即生效 |
| 按需点名 | `@dsh-collaboration/tool-team` | `team_call` 点名单个专项专家（以其人设+其模型作为子代理执行）；`roundtable` 并行召集多位专家；名册实时展示给主代理 |
| 模型对比 | `@dsh-collaboration/tool-model-compare` | 同一 prompt 并发发送多个模型，并排返回结果 |
| 多模态桥 | `@dsh-collaboration/tool-vision` | 纯文本主代理把图片/截图交给视觉模型，拿回文字分析 |
| 一键预设 | `config/agent-presets/collaboration` | standard 全量工具 + 上述工具（显示名：协同模式） |

**模型从哪来**：官方模型体系。默认只有 `deepseek-official`；用户在「设置 → 模型 → 添加供应商」里接入 OpenAI / Moonshot / OpenRouter / 硅基流动 / 智谱 GLM / vLLM 等（OpenAI 兼容协议），套件的名册与工具直接引用这些**已添加的供应商路由**。

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
```

## 安装与使用

见 [docs/installation.md](docs/installation.md)。核心步骤：

1. 在 DSH profile workspace 中安装四个包：`pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision`
2. 在 `cordis.patch.yml` 插入 `team` 宿主行，重启 DSH
3. 在「设置 → 模型 → 添加供应商」接入你要用的模型供应商（密钥在官方界面填写）
4. 在 `settings.yaml` 的 `collaboration-team` 段给每个身份指定模型（用已添加的路由名）
5. 复制 `config/agent-presets/collaboration` 到 `${DSH_HOME}/.agent-presets/`，新会话选择「协同模式」

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build
```

### 验证

```bash
node scripts/e2e-tools.mjs     # 新进程内驱动工具包 apply()，复现预设挂载校验路径
node scripts/check-roster.mjs  # 校验 settings.yaml 的 collaboration-team 名册
```

### 本地安装到 DSH（测试用）

```powershell
pnpm pack --dir packages/host/team   # 其余包同理，tarball 收集到 dist/
# 在 profile workspace 里：
pnpm add -w <path-to>.tgz ...
```

## License

[MIT](LICENSE)
