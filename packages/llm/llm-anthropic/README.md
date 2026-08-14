# @dsh-collaboration/llm-anthropic

Anthropic Messages API 适配器 —— 把 Claude 全系（含视觉）接入 DeepSeek Harness。

## 安装

```bash
pnpm add -w @dsh-collaboration/llm-anthropic
```

`cordis.patch.yml` 插入：

```yaml
- id: llm-anthropic
  name: '@dsh-collaboration/llm-anthropic'
```

重启后 `anthropic` 路由出现在模型选择器中，可作主模型或子代理模型。

## 配置

密钥：环境变量 `ANTHROPIC_API_KEY` 或 `.credentials.yaml`。细调在 `settings.yaml` 的 `llm-anthropic` 段：

```yaml
llm-anthropic:
  enabled: true
  apiKeyEnv: ANTHROPIC_API_KEY
  baseURL: https://api.anthropic.com
  models:            # 省略则用内置目录
    - { id: claude-sonnet-4, name: Claude Sonnet 4, contextWindow: 200000, maxTokens: 64000, vision: true }
  maxTokens: 8192
```

内置目录：claude-sonnet-4 / claude-opus-4 / claude-haiku-4.5 / claude-3.7-sonnet / claude-3.5-haiku（均标 `vision: true`）。

## 说明

- 相邻同角色消息在线上合并为单条（Anthropic 协议要求）。
- 工具调用以 `tool_use` 块发出，工具结果以 `tool_result` 块回传。
- Claude 的 thinking 内容映射为 harness 的 `reasoning` 块。

## License

[MIT](../../LICENSE)
