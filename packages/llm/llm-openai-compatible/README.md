# @dsh-openagent/llm-openai-compatible

OpenAI 兼容协议适配器 —— 一个适配器通吃所有 `/v1/chat/completions` 端点。

## 内置路由

| 路由 id | 提供商 | 默认端点 | 密钥环境变量 |
|---|---|---|---|
| `openai` | OpenAI（含 GPT-4o 视觉） | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `moonshot` | Moonshot Kimi | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `ollama` | Ollama 本地（无需密钥） | `http://localhost:11434/v1` | — |
| `openrouter` | OpenRouter（含 Claude/Gemini 视觉） | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `siliconflow` | 硅基流动（含 Qwen-VL 视觉） | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |

内置目录仅作建议：适配器接受端点支持的任何模型 id，视觉模型请在其条目上标 `vision: true`。

## 安装

在 DSH profile workspace 中：

```bash
pnpm add -w @dsh-openagent/llm-openai-compatible
```

在 `cordis.patch.yml` 中插入：

```yaml
- id: llm-openai-compatible
  name: '@dsh-openagent/llm-openai-compatible'
```

重启 DSH。此后 `openai`/`moonshot`/`ollama`/`openrouter`/`siliconflow`/`groq` 六个路由即出现在模型选择器中，并可作为主模型或子代理模型使用。

## 配置

密钥通过环境变量（上表）或 `.credentials.yaml` 提供；路由细调写在 `settings.yaml` 的 `llm-openai` 段：

```yaml
llm-openai:
  openai:
    enabled: true            # false 时撤销该路由
    apiKeyEnv: OPENAI_API_KEY
    baseURL: https://api.openai.com/v1
    models:                  # 覆写内置目录；省略则用内置
      - { id: gpt-4o, name: GPT-4o, contextWindow: 128000, maxTokens: 16384, vision: true }
  ollama:
    enabled: true            # 本地无密钥
  maxTokens: 16384           # 未声明容量的模型的总回退值
  defaultContextWindow: 128000
```

## 视觉支持

`vision: true` 的模型接受图片内容。图片以附件引用形式进入消息（`dsh-attachment` 服务提供字节），适配器将其编码为 OpenAI `image_url` data URL 发出。

## License

[MIT](../../LICENSE)
