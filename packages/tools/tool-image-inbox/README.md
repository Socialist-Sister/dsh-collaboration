# @dsh-collaboration/tool-image-inbox

图片收件箱 —— 纯文本主模型也能**直接粘贴图片**，不加任何按钮。

## 为什么需要它

DeepSeek Harness 的 `prompt` 端点在提交时校验当前模型的 `inputModalities`：DeepSeek 纯文本路由显式声明不含 `image`，贴图会被直接拒绝——配了观察员（looker）也接不到图。本包在平台规则内解决，体验是「粘贴即用」：

```
你在协同模式会话里粘贴图片
  → 客户端隐形桥（无 UI）在 window capture 层拦下 paste
  → 图片经 imageInbox/upload 存成会话工作区文件（.dsh-inbox/）
  → 草稿里自动插入 "[图片: <路径>]" 文字，直接回车发送
  → 主代理收到纯文本路径，按名册指引转交 vision 工具或 team_call 雇佣 looker
  → looker 已配置：正常看图分析；未配置：主代理提示你怎么配
```

文本主模型全程只见路径文字，图片从不进入纯文本线路；非协同模式的会话（以及纯文本粘贴）完全不受影响。

## 安装（宿主行）

```yaml
- insert:
    - id: collaboration-image-inbox
      name: '@dsh-collaboration/tool-image-inbox'
```

客户端半面由包内 `dsh.client` 声明自动挂载，无需其他配置。重启 DSH 生效。

## 实现要点（第三方包在 typert 体系里的正确姿势）

- **严格 invocation 注册（host）**：第三方包的 `@deepseek-ai/dsh-typert-protocol` 是 profile 里的独立副本，而网关的 SRC 回退（`remoteMethods` 扫描装饰器标记）只读**部署副本**的模块内 WeakMap——跨副本永远扫不到。因此宿主服务必须在构造时通过 `ctx.typert.register({face:'host', invocations:[...]})` 注册**严格描述符**（带 zod schema 的 codec + `typeSymbol`），网关路由优先走 `typert.local`。
- **客户端 Remote contribution（client）**：客户端模块自己构造 contribution 并 `ctx.remote.$mount(...)`，描述符每个 codec 必须带非空 `typeSymbol` 且 schema 是 **zod 4** 对象（网关要求 `.parse()`）；命名空间挂载后经 `ctx.get('remote.imageInbox')` 取服务（走 ctx 代理会触发 inject 守卫）。
- **调用约定**：`upload(sessionId, input)`——客户端无会话作用域时走 direct 路径，显式传 sessionId 作为 agent 查找参数。

## 行为

- **粘贴只入草稿，绝不唤醒代理**：上传只把路径写回客户端并插进草稿（looker 未配置时附带一句提示）；主代理在你**按下回车**后才开始处理，你有充足时间补字、调整。用户消息里的路径按 persona/名册指引转交 looker。
- 接受 PNG/JPEG/WebP/GIF，单张上限 20MB；文件名单路径段消毒，扩展名跟随媒体类型；
- 上传失败时把错误原因插入草稿（`[图片上传失败: ...]`），不吞错；
- 拦截判定：仅当会话的 composed preset 为 `collaboration`（宿主 `capability` 实时返回，会话切换时刷新）；
- 无工作目录、参数缺失、超大图片均拒绝，不落盘、不发消息。

## 验证

```bash
node scripts/e2e-image-inbox.mjs           # 宿主单测（28 项）
node scripts/verify-image-inbox.mjs --send # 真浏览器端到端（需临时 DSH 实例，见脚本头注释）
```

## License

[MIT](../../LICENSE)
