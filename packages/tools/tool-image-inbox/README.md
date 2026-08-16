# @dsh-collaboration/tool-image-inbox

图片上传通道 —— 让**纯文本主模型**也能通过界面收图。

## 为什么需要它

DeepSeek Harness 的 `prompt` 端点在提交时校验当前模型的 `inputModalities`：DeepSeek 纯文本模型显式声明不含 `image`，因此聊天框贴图会被直接拒绝（`MODEL_DOES_NOT_SUPPORT_IMAGES`）——即使名册里配了观察员（looker）也收不到图。本包在**平台规则内**解决：

- 输入框工具行（attach 旁）加一个「上传图片」按钮；
- 点按钮选图 → 图片字节经 `imageInbox/upload` Remote 方法发给宿主；
- 宿主把图片**存成会话工作区里的文件**（`.dsh-inbox/`），并以 plugin 来源的用户消息把路径告诉主代理；
- 主代理按名册指引把路径交给 `vision` 工具或 `team_call` 雇佣 looker 分析。

全程不碰 api-proxy 的门槛、不谎报模型多模态：文本主模型只看到路径文字，图片永远不进入纯文本线路。

## 安装（宿主行）

`cordis.patch.yml` 插入：

```yaml
- insert:
    - id: collaboration-image-inbox
      name: '@dsh-collaboration/tool-image-inbox'
```

客户端按钮由包内 `dsh.client` 声明自动挂载，无需其他配置。重启 DSH 后生效。

## 行为

- 接受 PNG/JPEG/WebP/GIF，单张上限 20MB；
- 文件名做单路径段消毒（防目录穿越），扩展名跟随媒体类型；
- 上传成功后按钮短暂显示「已保存」，同时会话里出现一条 plugin 来源消息通知主代理路径；
- 无工作目录的会话、参数缺失、超大图片均返回明确错误，不落盘、不发消息。

## License

[MIT](../../LICENSE)
