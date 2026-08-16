# Changelog

本文件记录 dsh-collaboration 各版本的变更（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 精神）。

## [v0.5.0] - Unreleased

### 新增：图片收件箱（隐形粘贴桥——纯文本主模型直接粘贴图片）

- **新包 `@dsh-collaboration/tool-image-inbox` 0.2.0（host+client 双面，无任何可见 UI）**：
  - 客户端隐形桥：window capture 层拦截图片粘贴（协同模式会话内），图片经 `imageInbox/upload` 存成会话工作区文件（`.dsh-inbox/`），草稿自动插入 `[图片: <路径>]`；文本粘贴与非协同会话零干扰；上传失败把原因写进草稿。
  - 宿主（`cordis.patch.yml` 新行 `collaboration-image-inbox`）：校验（20MB、媒体类型、文件名单路径段消毒）→ 落盘 → plugin 来源消息通知主代理（looker 已配置=路由指引 / 未配置=配置提示）；`capability` 端点按 `composedPreset === 'collaboration'` 决定是否拦截。
  - **合规**：不碰 api-proxy 的 `inputModalities` 门槛、不谎报多模态——文本主模型只见路径文字。
- **typert 第三方集成的三个根因（首版按钮崩溃的完整真相，均已修复）**：
  1. 宿主网关 SRC 回退读的是**部署副本** typert-protocol 的模块内 WeakMap，第三方包的独立副本永远扫不到 `@Remote` 标记 → 宿主改为 `ctx.typert.register` 注册**严格 invocation**（zod 4 schema + `typeSymbol`，`typert` 进 inject）；
  2. 客户端 contribution 每个 codec 必须带非空 `typeSymbol` 且 schema 是 **zod 4** 对象（网关要求 `.parse()`，schemastery 不行）；
  3. 命名空间挂载后经 `ctx.get('remote.imageInbox')` 取服务（走 ctx 代理触发 inject 守卫）。
- **验证**：宿主单测 28 项全绿（含 invocation 注册断言）；**临时 profile + 独立端口 + 真浏览器（Edge headless）端到端全绿**——boot 无错、粘贴拦截、路径入草稿、文件落盘、发送后主代理决策转交 looker、子代理启动、零失败请求。全程未触碰用户本机。
- **文档**：双语 README 新增「纯文本主模型怎么收图」；包 README 记录 typert 集成要点与验证命令。

## [v0.4.1] - Unreleased

### 行为调教：协调者人设与派活流程（实测反馈）

- **预设 persona 重写为中文协调者**：协作预设不再沿用官方 standard 的英文 "You are a coding agent…" 人设（实测导致主代理自己动手 + 输出英文）。新 persona：先简短分析任务结构、明确分工，再立即 `team_call` 派活；只调度与综合决策，不执行专家的本职工作；回复语言跟随用户消息。同步更新仓库预设与 `~/.dsh/.agent-presets/` 用户副本。
- **名册提示段升级（tool-team）**：主代理指引改为「目标 → 拆块 → 分工 → 派活」流程，明确「分析是为了分工，不是自己动手」「一句话级别的琐事才亲自处理」；lean 模式下 main 身份的完整协调者人设不再折叠（其他身份仍一行式）。
- **默认名册 main 身份（host:team）**：role 改为与 persona 一致的协调者文案；用户 `settings.yaml` 的 main role 已同步。
- **测试**：e2e-tools 断言更新——lean 模式保留 main 完整人设、其他身份省略；指引段校验「明确分工 + team_call」。

## [v0.4.0] - Unreleased

### 新增：专家互聊（求助转发通道）

- **`team_help` 子代理工具（host:team）**：通过 `registerContinuableSetup` 给每个持久专家实例安装子级作用域的 `team_help` 工具（伴随提示段，order 118，排在官方 report 指引之后）。专家需要另一位专家帮忙时调用 `team_help(to, task)`，本包用 `subagents.reportFrom` 以**唤醒投递**（wakeup）把 `[team-relay] <from> 请求 <to> 处理：<task>` 发给主代理。
- **合规边界**：专家间**从不直连**——权威协议只授权 父↔子 通道，因此互聊走「子 → 父 → 子」的星型授权路径，不伪造父权限、不触碰兄弟 inbox。
- **身份解析**：求助方身份优先从进程内注册表按 childId 解析；重启冷态回退到父会话持久 label 扫描（`team:reviewer#2` → `reviewer#2`）；再失败退回 `child:<id 前 8 位>`。
- **主代理路由指引（tool-team）**：`team_message` 描述与名册提示段补充 relay 路由——收到 `[team-relay]` 求助立即 `team_message` 转发给目标专家，待其 report 后再 `team_message` 转回求助方。
- **测试**：`scripts/e2e-team-host.mjs` 新增 v0.4 测试块——注册一个 continuable 贡献、安装 team_help 与提示段、执行后经 reportFrom 发出唤醒投递、`[team-relay]` 文本含求助方与目标、冷态 label 恢复身份解析。
- **文档**：中英文 README 新增「专家名册与擅长领域」章节（十身份各自专长 + 工具面分级说明 + 互聊机制）；README 与各包 README 移除全部 emoji。

## [v0.3.2] - Unreleased

### 修复与改进

- **tool:198 系统提示回归修复**：`systemPrompt` 段的 `workingSet` 检查误把函数引用当数组（`Array.isArray(函数)` 恒为 false），导致「当前在线实例」段永远为空——改为先调用再判断，并保持 `collaborationTeam` 服务缺失（undefined）时的兼容。
- **`team_message` 死代码渲染清理**：render 中的失败分支不可达（execute 失败一律 throw，`delivered` 恒为 true），已简化为直接输出「已发送给 …」；output schema 保持不变。
- **工具描述补充**：`team_status` 描述补 `dismissed` 状态；`team_message` 描述注明已解散实例拒绝投递。
- **文档 N1-N5**：team_call 参数表补 `tasks`、修正 `instances` 语义表述（同一份任务的分身，不同任务用 `tasks`）、章节标题 v0.2→v0.3、team_status 补 dismissed、team_message 补拒绝投递说明；另补 `config.providerName` 仅作用于一次性路径、安装文档的 cordis.patch.yml 新建方式与解散标记重启语义。
- **高危：冷态并发首雇竞态（host:team）**：spawn 的计数恢复是 read-modify-write——两个并发首次雇佣同一身份都会读到空计数器、各自 await listChildren 后得到相同 maxIndex，从而撞出相同 label（如两个 `reviewer#3`）。新增进程级 `recoveryLocks`：按 `${parentId}\u0000${identityId}` 共享同一次恢复 promise（listChildren 异常时回退 0、永久缓存不删除），await 后重读计数器取 max 再 +1，递增与 set 之间无 await，杜绝撞名。
- **高危：registry 清理/误标（host:team）**：`workingSet` 只返回真正存活的实例（`!dismissed && agents.get(childId) !== undefined`，`agents.get` 同步），「当前在线实例」不再把 settled 实例误标为 working、也不再无限膨胀；`close` 后 dismissed 记录从 bucket 摘除、解散标记转存 `dismissedRecovered`（followup 仍被拒、instances() 经 label 恢复显示 dismissed、工作集不再包含）；`spawn` 认领新 id 后清除该 id 的陈旧解散标记（防御性）。
- **测试**：新增 `scripts/e2e-team-host.mjs`（mock ctx 宿主逻辑测试，风格同 e2e-tools.mjs）——覆盖并发冷态 spawn 不撞名（共享恢复 promise、listChildren 只调用一次）、workingSet 存活过滤（live/settled/dismissed 三种）、close 摘除（工作集剔除、followup 拒绝、instances() 经 label 恢复显示 dismissed、重新雇佣不撞名）。

### 精简与分级工具面（接近极简模式表现，功能不减）

- **按身份分级工具面（toolFilter）**：名册身份新增 `toolFilter: { allow: [...] }`——研究/分析型（planner/reviewer/researcher/critic）只给 `read/glob/grep/web_search`；执行型（coder 给 `pwsh/read/write/edit/glob/grep/web_search/skill/todo_write`，debugger 给 `pwsh/read/glob/grep/edit`，writer 给 `read/write/edit/glob/grep`）；视觉型（looker/painter）给 `read/read_image/vision`。spawn 与一次性 wait/roundtable 路径均透传；白名单外的工具从专家提示与执行层同时消失（平台原生 `tools.restrict` 语义，未知名大声失败）。
- **名册提示段分级（rosterPrompt）**：`full`（身份+职责全文）/ `lean`（默认，一行式 `id — 名称（模型）`，不再每次组装注入全部人设）/ `off`（零注入，工具描述自带要点）。越低越接近极简预设的模型表现。
- **主代理「分配优先」引导**：主代理角色与名册段文案改为「更倾向于分配任务而非亲自动手——思考/审查/调研/写作交给专家」。
- **团队工具描述瘦身**：五个工具的描述压缩约 2/3，每次请求的 schema token 成本显著下降。

## [v0.3.1] - 2026-08-14

### 修复与改进（协同模式会话实测总结的处置）

- **I1（实质）**：`maxDepth` 对持久雇佣路径失效（spawn 硬编码 1）——现在 `SpawnOptions.maxDepth` 透传（默认 1），预设配置对 `team_call` 持久路径同样生效。
- **分身任务差异化**：`team_call` 新增 `tasks: string[]`——一次调用按任务数雇佣分身，每个分身拿到自己的任务（此前 `instances > 1` 只能下发同一份 task，实测发现）。
- **I4**：`tool-vision` 默认 provider/model 统一为 `zhipu` / `glm-4v-flash`，与预设和文档一致（0.2.0）。
- **文档修复**：I2（tgz 示例版本改为最新并注明"以最新 Release 为准"）、I3（model-compare / vision README 补 `config.system`）、I5（team README 补全 label 恢复与 close 扫描语义）；新用户清晰度 5 条（`${DSH_HOME}` 定义与路径统一、settings.yaml 位置、预设漂移快照警告、已有 patch 合并方式、验证清单补全四个团队工具）；补充 `team_status` 状态时窗说明。

## [v0.3.0] - 2026-08-14

### 修复（实例生命周期地基，"先正确后功能"）

协同模式会话的活体团队审查（reviewer×2 + planner 复核）发现并确认了以下正确性问题，本版全部修复：

- **F1 重启 label 碰撞**：计数从内存 1 起算，重启后再次雇佣会同名撞到已有持久子代理。现在 spawn 时从父会话的持久子代理 label（`team:<identityId>#<n>`）恢复最大计数。
- **F2 跨会话隔离**：实例注册表/计数/解散标记全部按 `parentSessionId` 分桶，A 会话的 `team_status`/`team_message`/`team_close` 不再看到或触碰 B 会话的实例。
- **F3 工作集收敛**：`workingSet()` 只返回未解散的实例（settled/dismissed 保留在 `instances()` 中展示）；提示段按父会话作用域渲染。
- **F4 身份 id 字符集校验**：名册 id 只允许 `[a-zA-Z0-9_-]`（校验期 + spawn 防卫），保证 label 解析可逆。
- **F5 wait 模式契约诚实化**：`team_call wait: true` 返回一次性标记（`instances: []` + `answer`），不再冒充可寻址的持久实例 id。

### 决策记录

- v0.3.1 起按「地基 → 团队频道 → 上下文经济与收敛」的顺序推进；网状拓扑缓至 v0.4（三重门槛：上游 authority protocol + F1–F5 全关闭 + 实测证据）。

## [v0.2.1] - 2026-08-14

### 修复

- **`team_close` 假成功 + 面板残留**（协同模式会话活体复现）：旧实现对未知/冷恢复实例静默返回、打断后不更新状态。现在 `close` 异步执行并校验实例存在（未知 id 大声失败），解散后：`team_message` 拒绝投递（明确报"已被解散"）、`team_status` 显示「已解散」状态。
  - 说明：底层 `interrupt` 只取消当前回合、子代理仍驻留等待（平台语义），本套件以「解散标记 + 拒绝消息 + 面板状态」实现可观察的解散语义。

## [v0.2.0] - 2026-08-14

### 新增

- **持久专家团队（实时协作）**：
  - `@dsh-collaboration/team` 0.2.0：名册身份升级为模板 + **实时实例注册表**。`spawn` 雇佣持久专家实例（continuable 子代理，label `team:<identityId>#<n>` 为持久真相，重启后可恢复识别）；`followup` 主→专家追问；`close` 解散；`instances`/`workingSet` 实时状态。
  - `@dsh-collaboration/tool-team` 0.2.0：`team_call` 默认雇佣持久实例，`instances` 参数支持**同一身份多分身**（reviewer#1/#2…），`wait: true` 保留 v0.1 一次性阻塞语义；新增 `team_message`（星型拓扑：专家间通信经主代理中转）、`team_status`（团队面板）、`team_close`（解散）；系统提示段升级为「名册 + 在线实例 + 控制台指引」。
- **通信模型（星型）**：主代理为枢纽——专家用内置 `report` 汇报、结算时自动通知主代理；专家 ↔ 专家经主代理转发，不直连。
- 验证：mock 单测（五工具、分身、边界守卫）+ 活体探针（真实 startContinuable / followup / listChildren 标签 / interrupt 全链路）。

## [v0.1.2] - 2026-08-14

### 修复

- **`maxDepth` 默认值 0 → 1**：子代理深度从 1 起算，`maxDepth: 0` 会让主代理的 `team_call`/`roundtable` 全部被拒（`subagent depth 1 exceeds maxDepth 0`）。活体探针在真实重启后发现并修复；`1` 的语义为「专家可被召集、但不得再向下委派」。预设行同步改为 `maxDepth: 1`。
- 本次由真实端到端探针验证：spawn 子代理 + `agentOptions` 模型覆盖 + 真实 DeepSeek API 调用全链路通过。

## [v0.1.1] - 2026-08-14

### 变更

- **专家模型语义：留空 = 跟随主模型**。名册里未填 `provider`/`model` 的身份不再报"未配置"错误，而是跟随当前会话主模型（聊天框选择器）执行；想给某身份单独配模型时才在 `settings.yaml` 的 `collaboration-team` 段填上。名册因此零配置可用。
  - `@dsh-collaboration/team` 0.1.1：`configured()` 语义更新、注释更新。
  - `@dsh-collaboration/tool-team` 0.1.1：`team_call` 仅在身份钉住模型时下发 `agentOptions`；`roundtable` 默认召集全部非 main 身份；名册提示段对未钉模型的身份显示「跟随主模型」。
- 提示：视觉身份（观察员）建议在 settings.yaml 钉一个视觉模型（如 `zhipu/glm-4v-flash`），否则它会跟随纯文本主模型、看图时在运行时报错。

## [v0.1.0] - 2026-08-14（重新发布）

### 变更

- **彻底移除自带 LLM 适配器，改为对接官方模型体系**：删除 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个包。模型供应商一律由用户在官方「设置 → 模型 → 添加供应商」接入（OpenAI 兼容协议等），本套件的名册与工具只引用**已添加的路由**。此改动同时永久消除与内置 pi-ai 目录的路由冲突（不再注册任何 provider）。
- **CI 防回归检查**：新增 Guard 步骤，仓库内任何包出现 `registerAdapter` / `registerConfigurableProviders` 即失败，防止再次引入路由冲突。
- 文档全面改写为官方接入流程；删除适配器专用测试脚本（e2e-mock / e2e-adapters）。

## [v0.1.0-alpha] - 2026-08-14（已撤回的初版）

### 新增（历史记录）

- `@dsh-collaboration/team`（专家名册）、`@dsh-collaboration/tool-team`（team_call / roundtable）、`@dsh-collaboration/tool-model-compare`、`@dsh-collaboration/tool-vision`、`collaboration` 预设。
- 初版自带 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个适配器；因与新版 DSH 内置 pi-ai 目录路由冲突（DUPLICATE_DIRECTORY），在 v0.1.0 重发布时移除。适配器时期通过 mock 协议全链路断言与智谱 GLM 真实 API（含 glm-4v-flash 识图）验证过序列化/视觉编码等逻辑。
