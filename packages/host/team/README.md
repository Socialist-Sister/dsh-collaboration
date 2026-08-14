# @dsh-collaboration/team

专家名册宿主包 —— 预设一组各司其职的身份，每个身份绑定自己的模型，全部由用户在 `settings.yaml` 中配置。

## 安装

`cordis.patch.yml` 插入（与适配器行并列）：

```yaml
    - id: collaboration-team
      name: '@dsh-collaboration/team'
```

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
| `looker` | 观察员（多模态） | **未配置，待你设置**（如 zhipu / glm-4v-flash） |
| `painter` | 画家（图像创作） | **未配置，待你设置**（如接入 gpt-image 类模型） |

## 自定义名册

在 `settings.yaml` 中写 `collaboration-team` 段（整个名册替换默认值，改完即生效）：

```yaml
collaboration-team:
  agents:
    - { id: main, name: 主代理, role: '…' }
    - { id: planner, name: 规划师, role: '…', provider: deepseek-official, model: deepseek-v4-pro }
    - { id: looker, name: 观察员, role: '看图与 UI 分析', provider: zhipu, model: glm-4v-flash }
    - { id: painter, name: 画家, role: '图像创作', provider: openai, model: gpt-image-1 }
```

`provider`/`model` 留空 = 未配置（除 `main` 外，被调用时工具会报出明确的配置提示）。

## License

[MIT](../../LICENSE)
