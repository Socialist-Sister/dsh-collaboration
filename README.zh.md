<div align="center">

# dsh-collaboration

**DeepSeek Harness 多智能体协同套件**

预设一组各司其职的专家身份，主代理按需点名调用 —— 模型走官方体系，团队交给本套件。

[English](README.md) · [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Socialist-Sister/dsh-collaboration)](https://github.com/Socialist-Sister/dsh-collaboration/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Socialist-Sister/dsh-collaboration/ci.yml?branch=main)](https://github.com/Socialist-Sister/dsh-collaboration/actions)

</div>

## 这是什么

受 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 多智能体工作台理念启发，但以 DeepSeek Harness 原生机制实现：

- **模型供应商由用户在官方「设置 → 模型 → 添加供应商」接入**（本套件不捆绑任何模型适配器，与官方目录零冲突）；
- **套件负责把团队组织起来**：专家名册、按需点名、圆桌评审、模型对比、多模态桥。

## 能力一览

| 能力 | 包 | 说明 |
|---|---|---|
| 🧑‍🤝‍🧑 专家名册 | `@dsh-collaboration/team` | 预设十身份（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手/观察员/画家），各司其职；每个身份的模型在 `settings.yaml` 自行配置，**改完即生效**；留空 = 跟随主模型。v0.2 起身份即模板，可雇佣为**持久专家实例**（可多分身） |
| 🎯 团队控制台 | `@dsh-collaboration/tool-team` | `team_call` 雇佣持久专家实例（`instances` 分身、`tasks` 按任务给每个分身分派不同工作）；`team_message` 追问/转发（星型拓扑）；`team_status` 团队面板；`team_close` 解散；`roundtable` 一次性并行圆桌 |
| ⚖️ 模型对比 | `@dsh-collaboration/tool-model-compare` | 同一 prompt 并发发送多个模型，答案并排返回 |
| 👁️ 多模态桥 | `@dsh-collaboration/tool-vision` | 纯文本主代理把图片/截图交给视觉模型，拿回文字分析 |
| 🎁 一键预设 | `config/agent-presets/collaboration` | standard 全量工具 + 上述工具（显示名：**协同模式**） |

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
  ├─ team_message → 追问/转发任何实例（专家间通信经主代理中转）
  ├─ team_status  → 实时团队面板；team_close → 解散实例
  ├─ model_compare → 多模型同题并发对比
  └─ vision       → 图片交给视觉模型 → 文字分析回传
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
scripts/                         验证脚本
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
雇佣两个 reviewer 分身，分别审查认证模块和支付模块。
用 team_message 让 reviewer#1 补充对会话固定攻击的分析。
把 critic 的质疑转发给 planner 评估。
开个 roundtable（planner、reviewer、critic）评估"把单体服务拆成微服务"。
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

## License

[MIT](LICENSE)
