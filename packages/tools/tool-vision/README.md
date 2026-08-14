# @dsh-collaboration/tool-vision

多模态桥工具 —— 让纯文本主代理（DeepSeek）"看见"图片。

## 工作原理

主代理调用 `vision` 工具，把工作区里的图片路径和一个问题交给配置好的视觉模型；工具读取图片字节、存入附件服务、构造带 image 块的标准消息，通过 `llm` 服务流式调用视觉模型，最后把文字分析返回给主代理继续工作。

## 配置（预设行或 settings）

```yaml
- id: tool-vision
  name: '@dsh-collaboration/tool-vision'
  config:
    provider: zhipu            # 默认视觉路由：官方「设置 → 模型」里已添加的供应商 ID
    model: glm-4v-flash        # 默认视觉模型（需支持图像输入）
    maxTokens: 4096
```

每次调用可用 `provider`/`model` 参数临时覆盖。

## 工具参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `images` | ✅ | 图片路径数组（工作区相对路径或绝对路径，PNG/JPEG/WebP/GIF） |
| `question` | ✅ | 问视觉模型的问题 |
| `provider` | | 覆盖默认路由 |
| `model` | | 覆盖默认模型 |

## License

[MIT](../../LICENSE)
