# @dsh-collaboration/team

专家名册 + 实时团队注册表宿主包 —— 预设一组各司其职的身份（模板），运行时雇佣为**持久专家实例**（continuable 子代理），每个身份绑定自己的模型，全部由用户在 `settings.yaml` 中配置。

## 安装

`cordis.patch.yml` 插入：

```yaml
    - id: collaboration-team
      name: '@dsh-collaboration/team'
```

## 服务接口（collaborationTeam）

| 方法 | 行为 |
|---|---|
| `roster()` / `resolve(id)` / `configured(agent)` | 名册查询（模板层） |
| `spawn(parent, identityId, task, opts)` | **雇佣一个持久实例**（同一身份可多次雇佣 → reviewer#1、reviewer#2… 分身；`opts.maxDepth` 透传委派深度，默认 1） |
| `followup(parent, instanceId, message)` | 主代理 → 实例追问（星型拓扑的中转也走它；已解散实例拒绝投递） |
| `close(parent, instanceId)` | 打断实例当前回合并标记解散（未知 id 大声失败） |
| `instances(parent)` / `workingSet(parentId?)` | 实例状态（working/settled/dismissed）；`workingSet` 为同步快照（仅未解散实例），供提示段 |

实例以 continuable 子代理实现：label 为 `team:<identityId>#<n>`（持久真相），进程内注册表为**按父会话分桶的缓存**。重启后计数从该父会话的持久 label 恢复（不撞名）；`close` 与 `followup` 对进程内不存在的实例也通过 label 扫描定位。专家用内置 `report` 工具汇报，结算时主代理自动收到通知。

## 默认名册

| id | 身份 | 默认模型 |
|---|---|---|
| `main` | 主代理（也就是会话主模型） | 继承会话主模型 |
| `planner` | 规划师 | deepseek-official / deepseek-v4-flash |
| `coder` | 工程师 | deepseek-official / deepseek-v4-flash |
| `debugger` | 调试员 | deepseek-official / deepseek-v4-flash |
| `reviewer` | 审查员 | deepseek-official / deepseek-v4-flash |
| `researcher` | 研究员 | deepseek-official / deepseek-v4-flash |
| `critic` | 评论家 | deepseek-official / deepseek-v4-flash |
| `writer` | 写手 | deepseek-official / deepseek-v4-flash |
| `looker` | 观察员（多模态） | **跟随主模型**（建议配视觉模型，如 zhipu / glm-4v-flash） |
| `painter` | 画家（图像创作） | **跟随主模型**（建议配图像模型） |

## 自定义名册

在 `settings.yaml` 中写 `collaboration-team` 段（整个名册替换默认值，改完即生效）：

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: '…' }
    - { id: planner, name: 规划师, role: '…', provider: deepseek-official, model: deepseek-v4-pro }
    - { id: looker, name: 观察员, role: '看图与 UI 分析', provider: zhipu, model: glm-4v-flash }
    - { id: painter, name: 画家, role: '图像创作', provider: zhipu, model: glm-4.5 }
```

`provider` 填官方「设置 → 模型」中已添加的供应商 ID（如 `zhipu`）或 `deepseek-official`。
`provider`/`model` 留空 = 跟随主模型（聊天框选择器）；给某身份单独配模型才填。
视觉身份建议配视觉模型，否则跟随纯文本主模型时看图会报错。

## License

[MIT](../../LICENSE)
