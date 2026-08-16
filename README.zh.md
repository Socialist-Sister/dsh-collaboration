<div align="center">

# dsh-collaboration

**DeepSeek Harness 多智能体协同套件**

预设一组各司其职的专家身份，主代理按需点名调用 —— 模型走官方体系，团队交给本套件。

[English](README.md) · [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Socialist-Sister/dsh-collaboration)](https://github.com/Socialist-Sister/dsh-collaboration/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Socialist-Sister/dsh-collaboration/ci.yml?branch=main)](https://github.com/Socialist-Sister/dsh-collaboration/actions)

<kbd>team</kbd> <kbd>tool-team</kbd> <kbd>tool-model-compare</kbd> <kbd>tool-vision</kbd> <kbd>tool-image-inbox</kbd>

</div>

---

## 目录

- [这是什么](#这是什么)
- [能力一览](#能力一览)
- [工作原理](#工作原理)
- [团队拓扑](#团队拓扑)
- [纯文本主模型怎么收图](#纯文本主模型怎么收图)
- [专家名册与擅长领域](#专家名册与擅长领域)
- [仓库结构](#仓库结构)
- [快速开始](#快速开始)
- [配置专家名册](#配置专家名册)
- [使用示例](#使用示例)
- [开发](#开发)
- [License](#license)

## 这是什么

受 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 多智能体工作台理念启发，但以 DeepSeek Harness 原生机制实现：

- **模型供应商由用户在官方「设置 → 模型 → 添加供应商」接入**（本套件不捆绑任何模型适配器，与官方目录零冲突）；
- **套件负责把团队组织起来**：专家名册、按需点名、圆桌评审、模型对比、多模态桥。

## 能力一览

| 能力 | 包 | 说明 |
|---|---|---|
| 专家名册 | `@dsh-collaboration/team` | 预设十身份（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手/观察员/画家），各司其职；每个身份的模型在 `settings.yaml` 自行配置，**改完即生效**；留空 = 跟随主模型。身份即模板，可雇佣为**持久专家实例**（可多分身）。v0.4 起专家自带 `team_help` 工具，可经主代理向其他专家求助 |
| 团队控制台 | `@dsh-collaboration/tool-team` | `team_call` 雇佣持久专家实例（`instances` 分身、`tasks` 按任务给每个分身分派不同工作）；`team_message` 追问/转发（星型拓扑，v0.4 增加 relay 路由）；`team_status` 团队面板；`team_close` 解散；`roundtable` 一次性并行圆桌 |
| 模型对比 | `@dsh-collaboration/tool-model-compare` | 同一 prompt 并发发送多个模型，答案并排返回 |
| 多模态桥 | `@dsh-collaboration/tool-vision` | 纯文本主代理把图片/截图交给视觉模型，拿回文字分析 |
| 图片收件箱 | `@dsh-collaboration/tool-image-inbox` | 隐形粘贴桥：协同模式里**直接粘贴图片**即自动存为工作区文件、路径进草稿，主代理转交 looker/vision——无按钮、纯文本主模型也能收图 |
| 一键预设 | `config/agent-presets/collaboration` | standard 全量工具 + 上述工具（显示名：**协同模式**） |

## 工作原理

```
官方「设置 → 模型」：deepseek-official + 用户添加的供应商（OpenAI 兼容协议等）
        │  已注册路由
        ▼
collaboration-team 名册（settings.yaml）   ←── 每个身份：人设 + 可选模型（模板）
        │  宿主服务 collaborationTeam（名册 + 实时实例注册表）
        ▼
主代理（协同模式预设，星型枢纽）
  ├─ team_call    → 雇佣持久专家实例（可多分身）→ 专家用 report 汇报 / 结算通知
  ├─ team_message → 追问/转发任何实例（专家间用 team_help 求助，经主代理中转）
  ├─ team_status  → 实时团队面板；team_close → 解散实例
  ├─ model_compare → 多模型同题并发对比
  └─ vision       → 图片交给视觉模型 → 文字分析回传
```

## 团队拓扑

每个身份都可雇佣多个分身实例（`reviewer#1`、`reviewer#2`……）。主代理是星型枢纽，所有消息都经它中转。

```
                     ┌─────────────────────┐
                     │    主代理（你）      │
                     │     星型枢纽        │
                     └──────────┬──────────┘
        team_call 雇佣 · team_message 双向转发
     ┌──────────────┬────────────┼────────────┬──────────────┐
     ▼              ▼            ▼            ▼              ▼
 planner#1      coder#1      looker#1      writer#1      reviewer#2   …
     │              │            │            │              │
     └───────────── report 汇报 / 结算通知 ────────────────┘
```

专家之间从不直连。某专家需要另一位专家帮忙时（例如研究员请观察员读图），求助绕行主代理：

```
researcher#1 ── team_help ──►  主代理收到 [team-relay]
      ▲                             │
      │                             ▼  team_message 转给 looker#1
      │                             │
      └──── team_message ◄────  looker#1 report 描述
```

## 纯文本主模型怎么收图

聊天框贴图入口受当前模型的 `inputModalities` 校验：DeepSeek 纯文本路由显式声明不含 `image`，贴图在提交时即被拒绝——配了观察员也接不到图。`tool-image-inbox` 在**平台规则内**解决，体验是粘贴即用：

```
在协同模式会话里粘贴图片
  → 客户端隐形桥拦下 paste（无按钮、无 UI）
  → 图片存成会话工作区文件（.dsh-inbox/）
  → 草稿里自动出现 "[图片: <路径>]"，回车发送
  → 主代理按名册指引转交 vision 工具或 team_call 雇佣 looker
  → looker 已配置：正常看图分析；未配置：主代理提示你怎么配
```

非协同模式会话与纯文本粘贴不受影响。备选路径：把图放进会话工作区目录报路径；或会话切到视觉路由（如 `zai/glm-5v-turbo`）直接贴图。

## 专家名册与擅长领域

默认名册预设十个身份，各有专长。工具面按职责分级：研究向身份只配只读工具，执行向身份配 shell/文件/技能工具，视觉向身份配 read + vision。

| id | 名称 | 擅长领域 | 工具面 |
|---|---|---|---|
| `main` | 主代理 | 统筹全局：先分析任务结构、明确分工，再用 `team_call` 派活给专家；汇总报告、拍板决策 —— 不亲自动手执行专家的本职工作 | 全量会话工具（不单独雇佣） |
| `planner` | 规划师 | 把复杂目标拆成可执行的步骤与里程碑，理清依赖、顺序与验收标准 | 只读：read/glob/grep/web_search |
| `coder` | 工程师 | 写实现代码、落地功能、修缺陷，遵循项目现有风格与约定 | 执行：pwsh/read/write/edit/glob/grep/web_search/skill/todo_write |
| `debugger` | 调试员 | 定位 bug：分析报错与日志，给出最小复现与修复方案 | 执行：pwsh/read/glob/grep/edit |
| `reviewer` | 审查员 | 审查代码与方案：找安全漏洞、边界条件、性能与可维护性风险 | 只读：read/glob/grep/web_search |
| `researcher` | 研究员 | 检索资料、调研技术与竞品、核实事实，输出有出处的结论 | 只读：read/glob/grep/web_search |
| `critic` | 评论家 | 独立视角挑刺：质疑假设、寻找盲点、模拟反对者，让方案更稳 | 只读：read/glob/grep/web_search |
| `writer` | 写手 | 撰写文档、报告、README 与文案，语言准确、结构清晰 | 执行：read/write/edit/glob/grep |
| `looker` | 观察员 | 看图、截图与 UI 的多模态分析：描述布局、提取文字、指出视觉问题 | 视觉：read/read_image/vision |
| `painter` | 画家 | 图像创作与生成：按需求描述产出或构思视觉素材 | 视觉：read/vision |

## 仓库结构

```
packages/
  host/team/                     专家名册（settings.yaml 可配置）
  tools/tool-team/               team_call 点名 + roundtable 圆桌
  tools/tool-model-compare/      同题多模型对比
  tools/tool-vision/             多模态桥
  tools/tool-image-inbox/        纯文本主模型的隐形粘贴收图通道
config/
  agent-presets/collaboration/   开箱即用的代理预设（协同模式）
docs/                            安装、配置与使用文档
scripts/                         验证脚本
```

## 快速开始

> 详细步骤见 [docs/installation.md](docs/installation.md)。

1. **安装五个包**到 DSH profile workspace：

   ```powershell
   pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision @dsh-collaboration/tool-image-inbox
   ```

   > 未发布到 npm 前，可从 [Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases) 下载 `.tgz` 附件安装。

2. **插入宿主行**（`cordis.patch.yml`）：

   ```yaml
   - insert:
       - id: collaboration-team
         name: '@dsh-collaboration/team'
       - id: collaboration-image-inbox
         name: '@dsh-collaboration/tool-image-inbox'
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

| 场景 | 主代理怎么做 |
|---|---|
| 并行审查 | `team_call` 配 `instances: 2` 雇佣两个 reviewer 分身，分别审两个模块 |
| 追问补充 | `team_message` 发给 `reviewer#1` 追问会话固定攻击 |
| 转达异议 | `team_message` 把 critic 的质疑转给 planner |
| 专家互助 | researcher 用 `team_help` 向 looker 求助，你转发请求并转回答复 |
| 圆桌评审 | `roundtable` 召集 planner、reviewer、critic 就同一议题发言 |
| 模型对比 | `model_compare` 同题对比 deepseek-v4-pro 与 zhipu/glm-4.5 |
| 看图分析 | `vision` 把截图交给视觉模型，拿回文字分析 |

## 开发

```bash
pnpm install      # 安装依赖
pnpm typecheck    # 全包类型检查
pnpm build        # 构建
```

### 验证

```bash
node scripts/e2e-tools.mjs     # 新进程驱动工具包 apply()，复现预设挂载校验
node scripts/e2e-team-host.mjs # 驱动团队宿主服务：实例生命周期 + team_help 求助中转
node scripts/check-roster.mjs  # 校验 settings.yaml 的 collaboration-team 名册
```

---

<div align="center">

**[MIT](LICENSE)** · **[仓库](https://github.com/Socialist-Sister/dsh-collaboration)** · **[Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases)**

</div>
