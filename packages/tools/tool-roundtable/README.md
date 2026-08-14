# @dsh-collaboration/tool-roundtable

专家圆桌工具 —— 多位专家（各是一个跑在自己模型上的子代理）并行发言，主代理当主持人综合结论。

## 配置

```yaml
- id: tool-roundtable
  name: '@dsh-collaboration/tool-roundtable'
  config:
    providerName: spawn         # 子代理后端（spawn = 全新子代理；fork = 继承父上下文）
    maxDepth: 0                 # 专家不得再向下委派
    experts:                    # 默认专家团（可被调用参数替换）
      - name: architect
        role: 一位资深的软件架构师，擅长权衡系统设计的取舍与长期可维护性。
        provider: deepseek-official
        model: deepseek-v4-pro
      - name: security
        role: 一位偏执的安全工程师，专门找出漏洞、攻击面与数据风险。
        provider: anthropic
        model: claude-sonnet-4
```

## 工具参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `topic` | ✅ | 圆桌议题 |
| `background` | | 所有专家需要的背景 |
| `experts` | | `[{name, role, provider, model}]`，覆盖默认专家团 |

所有专家**并行**发言；个别专家失败只产生该条目的 `error`。工具返回发言记录后，由主代理（主持人）在自己回答里完成综合。

## License

[MIT](../../LICENSE)
