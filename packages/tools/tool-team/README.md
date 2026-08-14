# @dsh-collaboration/tool-team

专项专家工具 —— 主代理按需**点名调用**名册中的身份，或召集多位专家**并行圆桌**。

依赖宿主行 `@dsh-collaboration/team`（提供 `collaborationTeam` 名册服务）。

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `team_call` | `agent`（身份 id）、`task`、`context?` | 点名单个专家：以其人设作为子代理执行任务；未钉模型的身份跟随主模型，钉了的跑自己的模型。答案返回主代理 |
| `roundtable` | `topic`、`agents?`（id 列表）、`background?` | 并行召集专家发言（默认全体专家，main 除外），主代理主持综合 |

另注册系统提示段：每次组装时向主代理展示实时名册（谁、干什么、什么模型、何时找谁）。

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
用 team_call 让 reviewer 审查我刚写的认证模块。
把这张截图交给 looker，让他描述 UI 问题。
开个 roundtable 评估「换用事件溯源架构」这个决定。
```

## License

[MIT](../../LICENSE)
