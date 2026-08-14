# @dsh-collaboration/tool-model-compare

同题多模型对比工具 —— 一个 prompt 并发发给多个模型，答案并排返回。

## 配置

```yaml
- id: tool-model-compare
  name: '@dsh-collaboration/tool-model-compare'
  config:
    models:                      # 默认对比集（可被调用参数替换）
      - { provider: deepseek-official, model: deepseek-v4-pro, label: DeepSeek }
      - { provider: zhipu, model: glm-4.5, label: GLM-4.5 }
    maxTokens: 3000
```

`provider` 填官方「设置 → 模型」中已添加的供应商 ID（如 `zhipu`）或 `deepseek-official`。

## 工具参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `prompt` | ✅ | 发给每个模型的同一 prompt |
| `models` | | `[{provider, model, label?}]`，覆盖配置默认集 |
| `system` | | 可选系统提示 |

单模型失败只产生该条目的 `error`，不影响其他模型。

配置中另有可选的 `config.system`（每次对比的系统提示默认值）。

## License

[MIT](../../LICENSE)
