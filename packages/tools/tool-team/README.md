# @dsh-collaboration/tool-team

主代理的团队控制台 —— 雇佣持久专家、跟进追问、查看状态、解散；也可召集一次性圆桌。

依赖宿主行 `@dsh-collaboration/team`（提供 `collaborationTeam` 名册 + 实例注册表服务）。

## 工具（v0.2）

| 工具 | 参数 | 行为 |
|---|---|---|
| `team_call` | `agent`（身份 id）、`task`、`context?`、`instances?`、`wait?` | **雇佣持久专家实例**（默认）：每个实例是长驻子代理，用自己的会话干活、用 `report` 汇报，结算时主代理收到通知；`instances` 可雇佣同一身份的多个**分身**（reviewer#1、reviewer#2…）并行处理不同任务；`wait: true` 退化为一次性阻塞调用（instances 必须为 1） |
| `team_message` | `to`（实例 id）、`message` | 主代理 → 实例追问/转发（**星型拓扑**：专家之间不直接通话，经主代理转达） |
| `team_status` | — | 实时团队面板：每个实例的 id / 身份 / working or settled |
| `team_close` | `instance`（实例 id） | 打断并解散一个实例 |
| `roundtable` | `topic`、`agents?`、`background?` | 一次性并行召集专家发言（默认全体，main 除外），主代理主持综合 |

另注册系统提示段：实时展示名册（模板）+ 当前在线实例 + 控制台用法指引。

## 通信模型（星型）

```
主代理（枢纽）
 ├─ team_call → 雇佣实例（可分多身）
 ├─ team_message → 任何实例（追问/转发）
 └─ team_close → 解散实例
        ▲  ▲
        │  └── 实例用 report 汇报 / 结算通知
        └───── 专家 A 想找专家 B：A report 给主代理 → 主代理 team_message 转给 B
```

## 安装（预设行）

```yaml
- id: tool-team
  name: '@dsh-collaboration/tool-team'
  config:
    providerName: spawn
    maxDepth: 1        # 必须 >= 1：主代理的专家子代理深度为 1；1 = 专家不得再向下委派
```

## 使用示例

```
雇佣两个 reviewer 分身分别审查认证模块和支付模块。
用 team_status 看看谁还在工作。
用 team_message 让 reviewer#1 补充关于会话固定攻击的分析。
把 critic 的意见转发给 planner 看看。
用 team_close 解散已经完成的 researcher#1。
开个 roundtable 评估「换用事件溯源架构」这个决定。
```

## License

[MIT](../../LICENSE)
