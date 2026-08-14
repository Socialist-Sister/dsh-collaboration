# @dsh-openagent/tool-model-compare

同题多模型对比工具 —— 一个 prompt 并发发给多个模型，答案并排返回。

## 配置

```yaml
- id: tool-model-compare
  name: '@dsh-openagent/tool-model-compare'
  config:
    models:                      # 默认对比集（可被调用参数替换）
      - { provider: deepseek-official, model: deepseek-v4-pro, label: DeepSeek }
      - { provider: openai, model: gpt-4o, label: GPT-4o }
      - { provider: anthropic, model: claude-sonnet-4, label: Claude }
    maxTokens: 3000
```

## 工具参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `prompt` | ✅ | 发给每个模型的同一 prompt |
| `models` | | `[{provider, model, label?}]`，覆盖配置默认集 |
| `system` | | 可选系统提示 |

单模型失败只产生该条目的 `error`，不影响其他模型。

## License

[MIT](../../LICENSE)
