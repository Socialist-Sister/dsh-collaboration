# @dsh-openagent/llm-gemini

Google Gemini API 适配器 —— 顶级多模态能力接入 DeepSeek Harness。

## 安装

```bash
pnpm add -w @dsh-openagent/llm-gemini
```

`cordis.patch.yml` 插入：

```yaml
- id: llm-gemini
  name: '@dsh-openagent/llm-gemini'
```

重启后 `gemini` 路由出现在模型选择器中。

## 配置

密钥：环境变量 `GEMINI_API_KEY` 或 `.credentials.yaml`。细调在 `settings.yaml` 的 `llm-gemini` 段：

```yaml
llm-gemini:
  enabled: true
  apiKeyEnv: GEMINI_API_KEY
  baseURL: https://generativelanguage.googleapis.com
  models:            # 省略则用内置目录
    - { id: gemini-2.5-flash, name: Gemini 2.5 Flash, contextWindow: 1000000, maxTokens: 65536, vision: true }
  maxTokens: 8192
```

内置目录：gemini-2.5-flash / gemini-2.5-pro / gemini-2.0-flash / gemini-2.0-flash-lite（均支持视觉）。

## 说明

- 请求走 `:streamGenerateContent?alt=sse`；SSE 流无 `[DONE]` 哨兵，以流结束为准。
- Gemini 没有工具调用 id，本适配器合成 `<函数名>#<序号>` 形式的 id，并靠函数名在线上关联 `functionResponse`。
- 图片以 `inlineData`（base64）part 发送。

## License

[MIT](../../LICENSE)
