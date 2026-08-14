# 安装指南

dsh-collaboration **不自带模型适配器**：模型供应商全部通过 DSH 官方机制接入，本套件只消费已注册的路由。

| 组件 | 平面 | 安装位置 |
|---|---|---|
| `@dsh-collaboration/team` 专家名册 | 宿主（host） | profile workspace + `cordis.patch.yml`；名册本体在 `settings.yaml` |
| `@dsh-collaboration/tool-*` 三个工具 | 代理（agent preset） | `collaboration` 预设行 |
| `collaboration` 预设（显示名：协同模式） | 代理 | `${DSH_HOME}/.agent-presets/collaboration/` |

## 前置条件

- DeepSeek Harness 已安装并可启动（本套件基于 `@deepseek-ai/dsh-*` 0.1.0-rc 系列 API）
- Node.js ≥ 20，pnpm ≥ 9
- 官方模型体系可用：默认路由 `deepseek-official`，以及「设置 → 模型」页的**添加供应商**功能（内置 pi-ai 目录提供）

## 1. 安装包到 profile workspace

> **路径约定**：本文的 `${DSH_HOME}` 指 DSH 用户数据目录（Windows 下通常为 `%USERPROFILE%\.dsh`）；`profile workspace` 指 `${DSH_HOME}\profiles\<profile名>`（本机示例为 `${DSH_HOME}\profiles\web`）。
> **发布到 npm 之前**，可以从 [Releases](https://github.com/Socialist-Sister/dsh-collaboration/releases) 下载 `.tgz` 附件，用本地路径安装（例如 `pnpm add -w ./downloads/dsh-collaboration-team-0.3.1.tgz ...`，版本号以最新 Release 为准）。发布后则直接用下方包名。

在 profile 目录执行：

```powershell
pnpm add -w @dsh-collaboration/team @dsh-collaboration/tool-team @dsh-collaboration/tool-model-compare @dsh-collaboration/tool-vision
```

profile workspace 使用 `nodeLinker: hoisted`，包与其依赖会被提升到 profile 根 `node_modules`，宿主行与预设行都从这里解析。

## 2. 在 `cordis.patch.yml` 插入名册宿主行

编辑 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`：

```yaml
- insert:
    - id: collaboration-team
      name: '@dsh-collaboration/team'
```

**不要禁用内置 `llm-pi-ai`**——官方「添加供应商」功能就是它提供的。本套件不注册任何模型路由，与官方目录天然无冲突。

> **已有 patch 内容怎么办**：`cordis.patch.yml` 是 YAML 数组，把上面的 `- insert:` 条目**追加进现有数组**即可（与已有条目并列，注意数组项以 `- ` 开头、与已有条目同级缩进）。若该文件尚不存在，直接新建即可——内容为顶层 YAML 数组（例如 `[]`，或直接放上面的 insert 条目）。用 `dsh --profile <名> --dump-config` 可随时验证合并结果。

## 3. 添加模型供应商（官方界面）

「设置 → 模型」页底部用官方**添加供应商**卡片接入各家（以智谱 GLM 为例）：

| 字段 | 示例值 |
|---|---|
| 供应商 ID | `zhipu`（名册里就填这个） |
| 端点 | `https://open.bigmodel.cn/api/paas/v4` |
| 协议 | OpenAI 兼容 |
| API Key | 你的智谱密钥 |
| 模型 | `glm-4.5`、`glm-4v-flash`（视觉）等 |

其他家同理：OpenAI（`https://api.openai.com/v1`）、Moonshot（`https://api.moonshot.cn/v1`）、OpenRouter（`https://openrouter.ai/api/v1`）、硅基流动（`https://api.siliconflow.cn/v1`）、本地 vLLM/Ollama 网关等，协议选 OpenAI 兼容即可。

> 注：多模态（视觉输入）由官方适配器按所加供应商的协议序列化图片；能否对某供应商发图取决于官方适配器对该协议+模型的支持，添加后请实测一次（例如让观察员看一张图）。

## 4. 配置专家名册（settings.yaml）

配置文件位置：`${DSH_HOME}\settings.yaml`（与 `.credentials.yaml` 同级）。`team` 行提供默认名册（主代理/规划师/工程师/调试员/审查员/研究员/评论家/写手 + 未配置的观察员/画家）。在 `collaboration-team` 段整体替换，**改完即生效**：

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: 统筹全局、按需调用专家 }
    - { id: planner, name: 规划师, role: 拆解任务, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: reviewer, name: 审查员, role: 审查代码与方案, provider: deepseek-official, model: deepseek-v4-flash }
    - { id: looker, name: 观察员, role: 看图与 UI 分析, provider: zhipu, model: glm-4v-flash }
    - { id: painter, name: 画家, role: 图像创作, provider: zhipu, model: glm-4.5 }
```

- `provider` 填**第 3 步创建的供应商 ID**（如 `zhipu`）或 `deepseek-official`
- `provider`/`model` **留空 = 跟随主模型**（聊天框右下角选择器选的模型）；想给某身份单独配模型才填
- 视觉身份（观察员）建议配一个支持视觉的模型（如 `zhipu/glm-4v-flash`），否则它跟随纯文本主模型、看图时报错

## 5. 安装「协同模式」预设（id: collaboration）

把本仓库的 `config/agent-presets/collaboration` 目录复制到用户预设根（`${DSH_HOME}\.agent-presets\`）：

```powershell
Copy-Item -Recurse <repo>\config\agent-presets\collaboration "$env:USERPROFILE\.dsh\.agent-presets\collaboration"
```

> **注意**：复制安装的预设是**漂移快照**——仓库更新预设后需重新复制（或手工同步改动）。已有会话不受影响，新会话按重启时的副本挂载。

## 6. 重启并验证

重启 DSH（patch 行与预设副本都在启动时生效；名册 settings 改动则实时生效）。验证：

1. 模型选择器默认只出现 `deepseek-official` + 你在第 3 步添加的供应商；
2. 新建会话选择「协同模式」预设，工具列表里出现 `team_call` / `team_message` / `team_status` / `team_close` / `roundtable` / `model_compare` / `vision`；
3. 若某身份/工具引用了未添加的路由，调用时对应条目只报错，不影响其他条目。

> 状态时窗说明：`team_status` 的 `working/settled` 基于子代理是否仍驻留，专家刚汇报完、结算通知送达前可能短暂显示 `working`，属正常时窗；`dismissed` 由本套件标记，即时准确。注意解散标记是**进程内存态**：DSH 重启后，已解散的实例会经 label 恢复为普通实例，需要时需重新解散。

## 7. 使用示例

在「协同模式」预设的会话里：

```
用 team_call 让 reviewer 审查我刚写的认证模块，指出安全风险。

把 docs/screenshot.png 交给 looker，让他描述这张 UI 截图里的布局和问题。

开个 roundtable（planner、reviewer、critic）评估"把单体服务拆成微服务"这个决定。

用 model_compare 对比 deepseek-v4-pro 和 zhipu/glm-4.5 对同一问题的回答。
```

## 故障排查

| 症状 | 处理 |
|---|---|
| 「协同模式」工具报 `NO_ADAPTER` / 模型调用失败 | 名册/工具配置里的 `provider` 未在官方「设置 → 模型」中添加；用添加供应商建同名路由，或改配置指向已添加的路由 |
| 观察员看图失败 | 官方适配器对所选供应商+模型是否支持视觉输入；换支持视觉的模型实测 |
| 预设挂载报行未激活 | 确认宿主装有 `subagents`/`llm`/`fs`/`attachments`/`collaborationTeam` 服务（`team` 宿主行已插 + 标准部署） |
