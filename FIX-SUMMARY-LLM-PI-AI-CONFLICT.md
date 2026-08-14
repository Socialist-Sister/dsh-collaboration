# dsh-collaboration × dsh 内置 llm-pi-ai 冲突修复记录

> 用途：本文件汇总了本次修复的完整过程，可发给协作者/其他 AI 代理阅读，以了解背景、复核改动或继续后续工作（提交、发版等）。
> 日期：2026-08-14

---

## 1. 背景

用户创建 dsh 的 `web` profile（`%USERPROFILE%\.dsh\profiles\web`）并接入 dsh-collaboration 套件后，`dsh web` 启动失败：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
failed to apply loader entry llm-pi-ai (@deepseek-ai/dsh-llm-pi-ai):
configurable provider "anthropic" is already declared
LlmError: ... code: 'DUPLICATE_DIRECTORY'
```

## 2. 根因

新版 dsh（0.1.0-rc.6+，base bundle 自带）内置插件 `@deepseek-ai/dsh-llm-pi-ai` 会**无条件注册** pi-ai 官方目录里所有支持 API key 的 provider（`anthropic`、`openai`、`openrouter`、`groq`、`google`、`deepseek`……），没有配置开关可以豁免单个 provider。

dsh-collaboration 套件恰好注册了 4 个同名 provider，cordis 的 llm 注册表不允许重名 → 整个插件树启动失败。**只修 anthropic 一个不够**，启动会接着撞 openai/openrouter/groq，4 个必须一起处理。

| 冲突名 | 官方内置 (pi-ai) | dsh-collaboration |
|---|---|---|
| `anthropic` | ✅ | `@dsh-collaboration/llm-anthropic` |
| `openai` | ✅ | `@dsh-collaboration/llm-openai-compatible` |
| `openrouter` | ✅ | 同上 |
| `groq` | ✅ | 同上 |

不冲突、未改动：`gemini`（pi-ai 官方是 `google`）、`moonshot`（官方是 `moonshotai`）、`ollama`、`siliconflow`、`zhipu`。

## 3. 修复方案（两步走，用户选定）

1. **先恢复启动**：在 profile 的 `cordis.patch.yml` 禁用内置 `llm-pi-ai`；
2. **再改套件源码**：4 个冲突路由加 `-compat` 后缀，重新构建打包安装，使套件与官方内置可共存（共存已实测通过）。

## 4. 改动清单

### 4.1 Profile 侧（用户配置）

**`C:\Users\ZengYiming\.dsh\profiles\web\cordis.patch.yml`**

新增（在原有 `- insert:` 块之前）：

```yaml
# The built-in llm-pi-ai plugin registers the official provider catalog
# (anthropic / openai / openrouter / groq / ...). The dsh-collaboration
# adapters now use -compat-suffixed routes and can coexist with it; this
# disable keeps the model selector free of duplicate provider entries.
# Delete these three lines to re-enable the official catalog (verified to
# boot clean alongside the renamed adapters).
- { id: llm-pi-ai, disabled: true }
```

### 4.2 套件源码（`D:\deepseek-harness\dsh-agents`，git 尚未提交）

路由改名（决定：统一 `-compat` 后缀，displayName 不变，UI 显示不受影响）：

| 文件 | 改动 |
|---|---|
| `packages/llm/llm-anthropic/src/index.ts` | `const PROVIDER = 'anthropic'` → `'anthropic-compat'`（注册 provider、适配器路由、错误消息统一走该常量）；文档注释同步 |
| `packages/llm/llm-anthropic/src/adapter.ts` | 注释 `anthropic` 路由 → `anthropic-compat`（仅文档） |
| `packages/llm/llm-openai-compatible/src/providers.ts` | 路由 id：`openai`→`openai-compat`、`openrouter`→`openrouter-compat`、`groq`→`groq-compat`（其余 4 个路由不动） |
| `packages/llm/llm-openai-compatible/src/index.ts` | settings schema 键同步改名：`OpenAiConfigSchema` 接口与 `Config` z.object 里的 `openai`/`openrouter`/`groq` → `'openai-compat'`/`'openrouter-compat'`/`'groq-compat'`（**必须与路由 id 一致**：settings 键 = 路由 id，`raw[route.id]` 按此读取，z.object 校验此键）；模块头注释同步 |
| `packages/tools/tool-model-compare/src/index.ts` | 工具参数 `provider` 的 description 示例改为 `openai-compat, anthropic-compat, gemini, deepseek-official` |

### 4.3 测试脚本

| 文件 | 改动 |
|---|---|
| `scripts/e2e-mock.mjs` | 测试用 provider id 同步改名（config 的 `connection().provider` 与请求 `provider` 字段）；**线上协议字符串不动**（`anthropic-version` 头、`x-api-key` 头、assert 标签等） |
| `scripts/e2e-adapters.mjs` | 同上（真实 API 测试的 config 与请求 provider 同步改名） |

### 4.4 文档

| 文件 | 改动 |
|---|---|
| `docs/installation.md` | 前置条件新增「新版 DSH 冲突说明 + `- { id: llm-pi-ai, disabled: true }` 处理法」；密钥表、模型选择器路由清单、painter 示例的 provider 改名 |
| `packages/llm/llm-anthropic/README.md` | 路由名 + 新增 `-compat` 后缀原因说明 |
| `packages/llm/llm-openai-compatible/README.md` | 路由表、settings 示例键、新增后缀说明 |
| `packages/tools/tool-model-compare/README.md` | 示例 provider 改名 |
| `packages/host/team/README.md` | painter 示例 provider 改名 |
| `CHANGELOG.md` | 新增 `[Unreleased]` 条目：改名明细 + 对存量 `settings.yaml` 键名的迁移提示 |

### 4.5 构建与安装

1. `pnpm typecheck`（7 包全绿）、`pnpm build`（tsup 全绿）
2. 离线验证：`node scripts/e2e-mock.mjs` 与 `node scripts/e2e-tools.mjs` 全断言通过
3. 重打两个改动的 tarball 到 `dist/`（文件名仍为 0.1.0 版）：
   - `dsh-collaboration-llm-anthropic-0.1.0.tgz`
   - `dsh-collaboration-llm-openai-compatible-0.1.0.tgz`
4. profile workspace（`C:\Users\ZengYiming\.dsh\profiles\web`）执行 `pnpm install --force` 重装
   - 注意：直接 `pnpm install` 不会感知 tarball 内容变化（lockfile 校验命中旧缓存），必须 `--force`，pnpm 会报 checksum 不匹配并自动重新解析

## 5. 验证结果（真实启动 3 次全部通过）

| 场景 | 结果 |
|---|---|
| 禁用 pi-ai + 旧套件（恢复态） | ✅ `dsh web: http://127.0.0.1:3080` |
| 禁用 pi-ai + 改名套件（最终状态） | ✅ 同上 |
| 临时 `--patch` 覆盖层重新启用 pi-ai + 改名套件（共存验证） | ✅ 同上，无 DUPLICATE_DIRECTORY |

另：`dsh --profile web --dump-config` 确认 patch 生效（`llm-pi-ai` 条目 `disabled: true`）。

## 6. 后续事项 / 注意事项

1. **git 未提交**：`dsh-agents` 仓库 13 个文件已改（`git status` 可见），等待用户决定是否提交/发版。
2. **版本**：tarball 仍以 0.1.0 打包；正式发版建议升 0.1.1 并把 CHANGELOG 的 `[Unreleased]` 落版本。
3. **pi-ai 开关**：当前 profile 保持 `llm-pi-ai` 禁用。如需官方内置 provider，删掉 `cordis.patch.yml` 中那三行即可（共存已验证）。启用后模型选择器会出现两套同名 displayName（官方 "Anthropic" vs 套件 "Anthropic"），可能造成困惑。
4. **存量配置迁移**：任何按旧路由名写的 `settings.yaml`（`llm-openai` / `llm-anthropic` 段）需把键名改为 `-compat` 后缀。当前用户机器无此配置，无需迁移；`~/.dsh/settings.yaml` 的 `collaboration-team` 名册与 `.agent-presets/collaboration` 预设均用 `deepseek-official`/`zhipu`，不受影响。
5. **命名可议**：`-compat` 后缀是本次采取的默认方案（理由：与包名 llm-openai-compatible 一致、直观、与官方目录天然区隔）。若团队更倾向 `claude` / `dshc-` 前缀等其他命名，改 `providers.ts` 与 `index.ts` 的常量即可，改动面相同。

---

## 7. 最终决策（2026-08-14，用户拍板）

`-compat` 方案被推翻，改为**彻底移除自带适配器、直接对接官方模型体系**：

- 删除 `llm-openai-compatible` / `llm-anthropic` / `llm-gemini` 三个包（连同本文件的 `-compat` 改名工作一并作废）；
- 模型供应商一律由用户在官方「设置 → 模型 → 添加供应商」（内置 pi-ai 的 custom provider 流程）接入；
- 套件保留：`team`（名册）+ `tool-team` / `tool-model-compare` / `tool-vision`（工具），全部只引用**已添加的路由**（如 `deepseek-official`、用户自建的 `zhipu`）；
- profile 恢复启用 `llm-pi-ai`，patch 仅保留 `collaboration-team` 一行；
- CI 增加防回归 Guard：仓库内任何包出现 `registerAdapter` / `registerConfigurableProviders` 即失败。

理由：自带适配器与官方目录存在结构性冲突（本文件第 2 节），且会在模型设置页制造大量重复供应商条目；官方「添加供应商」已覆盖 OpenAI 兼容协议等主流接入方式，套件只需消费路由，职责更干净。本文件保留作历史记录。
