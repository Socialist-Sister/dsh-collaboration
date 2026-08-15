/**
 * `@dsh-collaboration/team`: the named specialist roster AND live team registry
 * for DeepSeek Harness.
 *
 * A HOST-plane row that registers the `collaboration-team` settings namespace
 * and publishes the `collaborationTeam` service. The roster is a list of agent
 * identities — each with a stable id, a display name, a duty (`role`), an
 * optional persona, and an optional provider/model — that the user edits in
 * `settings.yaml`.
 *
 * v0.2 adds the LIVE TEAM layer on top of the roster: identities act as
 * templates that the main agent hires as PERSISTENT specialist instances
 * (continuable subagents). Every instance has its own durable session:
 *
 *   - `spawn()`    hire one instance (same identity can be hired N times:
 *                  `reviewer#1`, `reviewer#2`, … — the multi-clone feature)
 *   - `followup()` main → specialist message (child wakes and answers)
 *   - `close()`    interrupt one instance
 *   - `instances()`/`workingSet()`  live status for the main agent
 *
 * Specialist → main happens through the child's built-in `report` tool; the
 * continuation manager delivers a settlement notice to the parent when an
 * instance finishes. Specialist ↔ specialist communication is STAR-shaped:
 * routed through the main agent (the chat coordinator), never direct. v0.4
 * adds the child-scoped `team_help` tool (installed via
 * `registerContinuableSetup`): a specialist asks another specialist by
 * reporting a `[team-relay]` request to the main agent, which forwards it
 * with `team_message` and relays the answer back.
 *
 * Identities with an empty `provider`/`model` FOLLOW THE SESSION MODEL (the
 * chat-box selector): the roster works with zero configuration, and a user
 * pins `provider`/`model` only for the identities that deserve their own
 * model (e.g. a vision model for `looker`).
 * @module @dsh-collaboration/team
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'team'
export const inject = ['settings', 'subagents', 'agents']

export const NS = settingsNamespace('collaboration-team')

/** One named specialist identity. */
export interface TeamAgent {
  /** Stable id, also the `team_call` lookup key. */
  id: string
  /** Human-readable display name. */
  name: string
  /** What this identity is responsible for (its duty statement). */
  role: string
  /** Optional extra persona text, appended after `role` in the child prompt. */
  persona?: string
  /** Provider route this identity runs on; empty = follows the session model. */
  provider?: string
  /** Model id this identity runs; empty = follows the session model. */
  model?: string
  /** Optional per-request output cap for this identity. */
  maxTokens?: number
  /**
   * Optional child tool scoping (per-identity capability surface). The
   * allowlist keeps the specialist's tool face minimal for its duty —
   * research/analysis identities get read-only tools, execution identities
   * get shell/file tools. Empty = inherit the full preset toolset.
   */
  toolFilter?: { allow?: string[]; deny?: string[] }
}

/**
 * The default roster. `main` is the session's own agent; every identity
 * with an EMPTY provider/model FOLLOWS the session's model (the chat-box
 * selector) — pinning one in settings.yaml gives that identity its own
 * model. `looker` and `painter` ship empty so the user picks suitable
 * vision / image models; the other identities default to the cheap
 * deepseek-v4-flash route, re-pointable at any time.
 */
export const DEFAULT_ROSTER: readonly TeamAgent[] = [
  {
    id: 'main',
    name: '主代理',
    role: '你是本会话的团队主协调者：接到任务先做简短的结构分析、明确分工（哪块派给哪位专家），然后立即用 team_call 派活；你负责调度与综合决策，不亲自动手执行专家的本职工作（研究、编码、审查、看图等），一句话级别的琐事除外。',
  },
  {
    id: 'planner',
    name: '规划师',
    role: '把复杂目标拆解为可执行的步骤与里程碑，明确依赖、顺序和验收标准。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['read', 'glob', 'grep', 'web_search'] },
  },
  {
    id: 'coder',
    name: '工程师',
    role: '编写实现代码、落地功能、修复缺陷，遵循项目现有风格与约定。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'web_search', 'skill', 'todo_write'] },
  },
  {
    id: 'debugger',
    name: '调试员',
    role: '定位 bug、分析报错与日志、给出最小可复现与修复方案。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['pwsh', 'read', 'glob', 'grep', 'edit'] },
  },
  {
    id: 'reviewer',
    name: '审查员',
    role: '审查代码与方案，找出安全漏洞、边界条件、性能与可维护性风险。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['read', 'glob', 'grep', 'web_search'] },
  },
  {
    id: 'researcher',
    name: '研究员',
    role: '检索资料、调研技术与竞品、核实事实，输出有出处的结论。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['read', 'glob', 'grep', 'web_search'] },
  },
  {
    id: 'critic',
    name: '评论家',
    role: '以独立视角挑刺：质疑假设、寻找盲点、模拟反对者，帮方案变得更稳。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['read', 'glob', 'grep', 'web_search'] },
  },
  {
    id: 'writer',
    name: '写手',
    role: '撰写文档、报告、README 与文案，语言准确、结构清晰。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    toolFilter: { allow: ['read', 'write', 'edit', 'glob', 'grep'] },
  },
  {
    id: 'looker',
    name: '观察员',
    role: '看图、截图与 UI 的多模态分析：描述布局、提取文字、指出视觉问题。',
    toolFilter: { allow: ['read', 'read_image', 'vision'] },
  },
  {
    id: 'painter',
    name: '画家',
    role: '图像创作与生成：根据需求描述产出或构思视觉素材。',
    toolFilter: { allow: ['read', 'vision'] },
  },
]

const ToolFilterSchema = z.object({
  allow: z.array(z.string()),
  deny: z.array(z.string()),
})

const AgentSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  toolFilter: ToolFilterSchema,
})

export interface TeamConfigSchema {
  agents?: {
    id?: string | null
    name?: string | null
    role?: string | null
    persona?: string | null
    provider?: string | null
    model?: string | null
    maxTokens?: number | null
    toolFilter?: { allow?: string[] | null; deny?: string[] | null } | null
  }[] | null
}

export const TeamSchema: z<TeamConfigSchema> = z.object({
  agents: z.array(AgentSchema),
})

export const Config: z<TeamConfigSchema> = TeamSchema

/** One hired specialist instance (a persistent continuable child). */
export interface TeamInstance {
  /** Instance id, e.g. `reviewer#1`; stable within this process. */
  readonly instanceId: string
  /** The roster identity this instance was hired from. */
  readonly identityId: string
  /** Display name of the identity. */
  readonly name: string
  /** The durable child session id. */
  readonly childId: SessionId
  /** The child's persisted creation label (`team:<instanceId>`). */
  readonly label: string
  /** Epoch milliseconds when this instance was hired. */
  readonly createdAt: number
}

/** A live view of one instance, with its current status. */
export interface TeamInstanceView extends TeamInstance {
  readonly status: 'working' | 'settled' | 'dismissed'
}

/** Options for hiring one specialist instance. */
export interface SpawnOptions {
  /** Optional background context appended to the task. */
  context?: string
  /** Caller cancellation, owning the operation until inbox acceptance. */
  signal?: AbortSignal
  /** Delegation-depth cap for the child; defaults to 1 (no further delegation). */
  maxDepth?: number
}

/** The service published under `collaborationTeam`. */
export interface TeamService {
  /** The current roster, resolved from settings at every call. */
  roster(): TeamAgent[]
  /** Resolve one identity by id, or undefined when unknown. */
  resolve(id: string): TeamAgent | undefined
  /** Whether one identity pins its own model (empty = follows the session model). */
  configured(agent: TeamAgent): boolean
  /** Build the standalone specialist prompt for one identity + task. */
  promptFor(agent: TeamAgent, task: string, extra?: string): string
  /** Hire one persistent specialist instance; resolves once the child accepted the task. */
  spawn(parent: Agent, identityId: string, task: string, opts?: SpawnOptions): Promise<TeamInstance>
  /** Send one message from the main agent to a hired instance. */
  followup(parent: Agent, instanceId: string, message: string, signal?: AbortSignal): Promise<{ instanceId: string; messageId: MessageId }>
  /**
   * Dismiss one hired instance: interrupts its current turn and marks it
   * dismissed. Rejects with a clear error when the instance is unknown.
   * Dismissed instances refuse further `followup`s and show as `dismissed`
   * in `instances()`.
   */
  close(parent: Agent, instanceId: string): Promise<void>
  /** Live status of every instance visible to this parent (registry + persisted labels). */
  instances(parent: Agent): Promise<TeamInstanceView[]>
  /** Synchronous snapshot of live, non-dismissed instances hired in this process (for prompt sections); optional parent-session scope. */
  workingSet(parentSessionId?: string): TeamInstance[]
}

function toAgent(entry: any): TeamAgent {
  const allow = Array.isArray(entry.toolFilter?.allow) ? entry.toolFilter.allow.filter((name: unknown) => typeof name === 'string' && name.length > 0) : []
  const deny = Array.isArray(entry.toolFilter?.deny) ? entry.toolFilter.deny.filter((name: unknown) => typeof name === 'string' && name.length > 0) : []
  const toolFilter = allow.length > 0 || deny.length > 0 ? { ...(allow.length > 0 ? { allow } : {}), ...(deny.length > 0 ? { deny } : {}) } : undefined
  return {
    id: entry.id ?? '',
    name: entry.name ?? entry.id ?? '',
    role: entry.role ?? '',
    ...(entry.persona !== undefined && entry.persona !== null && entry.persona.length > 0 ? { persona: entry.persona } : {}),
    ...(entry.provider !== undefined && entry.provider !== null && entry.provider.length > 0 ? { provider: entry.provider } : {}),
    ...(entry.model !== undefined && entry.model !== null && entry.model.length > 0 ? { model: entry.model } : {}),
    ...(entry.maxTokens !== undefined && entry.maxTokens !== null ? { maxTokens: entry.maxTokens } : {}),
    ...(toolFilter !== undefined ? { toolFilter } : {}),
  }
}

function validateRoster(value: TeamConfigSchema) {
  const agents = value.agents ?? []
  const seen = new Set<string>()
  for (const agent of agents) {
    const id = agent?.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('collaboration-team: every agent needs a non-empty id')
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`collaboration-team: invalid agent id "${id}" — ids may only contain letters, digits, underscores and hyphens`)
    }
    if (seen.has(id)) throw new Error(`collaboration-team: duplicate agent id "${id}"`)
    seen.add(id)
  }
}

/** Parse an instance label (`team:reviewer#2`) back into its identity and index. */
export function parseInstanceLabel(label: string): { identityId: string; index: number } | undefined {
  const match = /^team:([a-zA-Z0-9_-]+)#(\d+)$/.exec(label)
  if (match === null) return undefined
  return { identityId: match[1], index: Number(match[2]) }
}

/** Build the standalone specialist prompt for one identity + task. */
export function buildSpecialistPrompt(agent: TeamAgent, task: string, extra?: string): string {
  const lines = [
    `你是主代理团队中的专项专家：${agent.name}（${agent.id}）。`,
    `你的职责：${agent.role}`,
  ]
  if (agent.persona !== undefined && agent.persona.length > 0) lines.push(`你的行事风格：${agent.persona}`)
  lines.push(``, `任务：${task}`)
  if (extra !== undefined && extra.trim().length > 0) lines.push(``, `背景与要求：${extra}`)
  lines.push(
    ``,
    `完成任务后用 report 工具把结论报告给主代理；收到主代理的追问就继续处理，没有新消息时保持待命。`,
    `回复语言跟随任务所用语言。`,
  )
  return lines.join('\n')
}

export function apply(ctx: any) {
  const scope = ctx.settings.register(NS, TeamSchema, {
    base: { agents: [...DEFAULT_ROSTER] as any },
    applies: 'live',
    validate: validateRoster,
  })

  const roster = (): TeamAgent[] => scope.get().agents?.map(toAgent) ?? []

  const resolve = (id: string): TeamAgent | undefined => roster().find((agent) => agent.id === id)

  const configured = (agent: TeamAgent): boolean => agent.provider !== undefined && agent.model !== undefined

  const promptFor = (agent: TeamAgent, task: string, extra?: string): string => buildSpecialistPrompt(agent, task, extra)

  // ── live instance registry (process-local cache; labels are the durable truth) ──
  interface LiveRecord extends TeamInstance {
    dismissed?: boolean
  }
  // F2: per-parent buckets — sibling sessions are isolated from each other.
  const buckets = new Map<string, Map<string, LiveRecord>>()
  const counters = new Map<string, Map<string, number>>()
  // Instance ids dismissed through label recovery (not in the live registry).
  const dismissedRecovered = new Map<string, Set<string>>()
  // R1: one shared counter-recovery promise per (parent, identity), cached
  // forever. Without this, two concurrent cold-state first hires of the same
  // identity both read an empty counter, both await listChildren and derive
  // the same maxIndex — then collide on the same label (e.g. reviewer#3 twice).
  const recoveryLocks = new Map<string, Promise<number>>()

  /** Recover the highest persisted index for one identity from durable child labels. */
  const recoverMaxIndex = async (sessionId: SessionId, identityId: string): Promise<number> => {
    let maxIndex = 0
    try {
      const children = await ctx.subagents.listChildren(sessionId)
      for (const child of children) {
        const parsed = parseInstanceLabel(child.label ?? '')
        if (parsed !== undefined && parsed.identityId === identityId) {
          maxIndex = Math.max(maxIndex, parsed.index)
        }
      }
    } catch {
      /* persistence unavailable — registry-only counting */
    }
    return maxIndex
  }

  const bucketOf = (parentId: string): Map<string, LiveRecord> => {
    let bucket = buckets.get(parentId)
    if (bucket === undefined) {
      bucket = new Map()
      buckets.set(parentId, bucket)
    }
    return bucket
  }

  const counterOf = (parentId: string): Map<string, number> => {
    let counter = counters.get(parentId)
    if (counter === undefined) {
      counter = new Map()
      counters.set(parentId, counter)
    }
    return counter
  }

  const dismissedOf = (parentId: string): Set<string> => {
    let set = dismissedRecovered.get(parentId)
    if (set === undefined) {
      set = new Set()
      dismissedRecovered.set(parentId, set)
    }
    return set
  }

  // F3: the working set only contains LIVE, non-dismissed instances —
  // `agents.get` is synchronous, so a settled child (gone from the agent
  // registry) is filtered out too, keeping the "当前在线实例" prompt section
  // honest and bounded instead of accumulating settled entries.
  const workingSet = (parentSessionId?: string): TeamInstance[] => {
    const records: LiveRecord[] = []
    if (parentSessionId === undefined) {
      for (const bucket of buckets.values()) records.push(...bucket.values())
    } else {
      records.push(...(buckets.get(parentSessionId)?.values() ?? []))
    }
    return records.filter((record) => !record.dismissed && ctx.agents.get(record.childId) !== undefined)
  }

  const recordFromLabel = (label: string, childId: SessionId): TeamInstance | undefined => {
    const parsed = parseInstanceLabel(label)
    if (parsed === undefined) return undefined
    const identity = resolve(parsed.identityId)
    return {
      instanceId: `${parsed.identityId}#${parsed.index}`,
      identityId: parsed.identityId,
      name: identity?.name ?? parsed.identityId,
      childId,
      label,
      createdAt: 0,
    }
  }

  const isDismissed = (parentId: string, instanceId: string): boolean => {
    const hit = buckets.get(parentId)?.get(instanceId)
    return (hit?.dismissed ?? false) || (dismissedRecovered.get(parentId)?.has(instanceId) ?? false)
  }

  const resolveChildId = async (parent: Agent, instanceId: string): Promise<SessionId> => {
    const parentId = String(parent.session.id)
    const hit = buckets.get(parentId)?.get(instanceId)
    if (hit !== undefined) return hit.childId
    const children = await ctx.subagents.listChildren(parent.session.id)
    for (const child of children) {
      const record = recordFromLabel(child.label ?? '', child.id)
      if (record !== undefined && record.instanceId === instanceId) return child.id
    }
    throw new Error(`未知的专家实例 "${instanceId}"——用 team_status 查看当前在线实例。`)
  }

  const spawn: TeamService['spawn'] = async (parent, identityId, task, opts) => {
    const agent = resolve(identityId)
    if (agent === undefined) throw new Error(`未知专家 "${identityId}"。当前名册：${roster().map((a) => a.id).join(', ')}。`)
    if (!/^[a-zA-Z0-9_-]+$/.test(identityId)) {
      throw new Error(`身份 id "${identityId}" 含非法字符——名册 id 只允许字母、数字、下划线和连字符。`)
    }
    const parentId = String(parent.session.id)
    const counter = counterOf(parentId)
    let index = counter.get(identityId)
    if (index === undefined) {
      // F1 + R1: recover the counter from persisted child labels after a
      // restart — via ONE shared promise per (parent, identity), so parallel
      // cold-state first hires of the same identity never race listChildren
      // and derive the same maxIndex (which would collide on the same label).
      const key = `${parentId}\u0000${identityId}`
      let pending = recoveryLocks.get(key)
      if (pending === undefined) {
        pending = recoverMaxIndex(parent.session.id, identityId)
        recoveryLocks.set(key, pending)
      }
      const base = await pending
      // Re-read the counter after the await: another concurrent caller may
      // have already incremented past the recovered base.
      const current = counter.get(identityId)
      index = current !== undefined ? Math.max(current, base) : base
    }
    index += 1
    // No await between the increment and the set: the counter is the
    // collision gate for concurrent hires.
    counter.set(identityId, index)
    const instanceId = `${identityId}#${index}`
    // Defensive: a stale dismissal mark for this exact id must not reject
    // followups to the freshly hired instance (e.g. after a failed recovery
    // re-issued an id that a label-recovered child previously owned).
    dismissedOf(parentId).delete(instanceId)
    const label = `team:${instanceId}`
    const start = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label,
      request: {
        prompt: [{ type: 'text', text: promptFor(agent, task, opts?.context) }],
        parent,
        ...(configured(agent)
          ? {
              agentOptions: {
                provider: agent.provider,
                model: agent.model,
                ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
              },
            }
          : {}),
        ...(agent.toolFilter !== undefined ? { toolFilter: agent.toolFilter } : {}),
        maxDepth: opts?.maxDepth ?? 1,
      },
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    })
    const record: TeamInstance = {
      instanceId,
      identityId,
      name: agent.name,
      childId: start.childId,
      label,
      createdAt: Date.now(),
    }
    bucketOf(parentId).set(instanceId, record)
    return record
  }

  const followup: TeamService['followup'] = async (parent, instanceId, message, signal) => {
    if (isDismissed(String(parent.session.id), instanceId)) {
      throw new Error(`专家实例 "${instanceId}" 已被解散，无法再发送消息。`)
    }
    const childId = await resolveChildId(parent, instanceId)
    const messageId = await ctx.subagents.followup(parent, childId, [{ type: 'text', text: message }], {
      source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.session.id },
      ...(signal !== undefined ? { signal } : {}),
    })
    return { instanceId, messageId }
  }

  const close: TeamService['close'] = async (parent, instanceId) => {
    const childId = await resolveChildId(parent, instanceId)
    ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parent })
    const parentId = String(parent.session.id)
    const hit = buckets.get(parentId)?.get(instanceId)
    if (hit !== undefined) {
      // Mark, then drop the record from the live bucket; the dismissal moves to
      // dismissedRecovered so followup stays rejected and instances() keeps
      // showing the instance as dismissed (via label recovery), while
      // workingSet no longer includes it.
      hit.dismissed = true
      buckets.get(parentId)?.delete(instanceId)
      dismissedOf(parentId).add(instanceId)
    } else {
      dismissedOf(parentId).add(instanceId)
    }
  }

  const instances: TeamService['instances'] = async (parent) => {
    const parentId = String(parent.session.id)
    const views = new Map<string, TeamInstanceView>()
    for (const record of buckets.get(parentId)?.values() ?? []) {
      const live = ctx.agents.get(record.childId)
      const status = record.dismissed ? 'dismissed' : live === undefined ? 'settled' : 'working'
      views.set(record.instanceId, { ...record, status })
    }
    let children: { id: SessionId; label?: string }[] = []
    try {
      children = (await ctx.subagents.listChildren(parent.session.id)) as any
    } catch {
      /* persistence unavailable — registry-only view */
    }
    for (const child of children) {
      const record = recordFromLabel(child.label ?? '', child.id)
      if (record === undefined || views.has(record.instanceId)) continue
      const live = ctx.agents.get(child.id)
      const status = dismissedOf(parentId).has(record.instanceId) ? 'dismissed' : live === undefined ? 'settled' : 'working'
      views.set(record.instanceId, { ...record, status })
    }
    return [...views.values()]
  }

  ctx.provide('collaborationTeam', {
    roster,
    resolve,
    configured,
    promptFor,
    spawn,
    followup,
    close,
    instances,
    workingSet,
  } satisfies TeamService)

  // ── specialist → specialist relay (v0.4) ─────────────────────────────
  // Specialists are continuable children and the authority protocol only
  // authorizes child ↔ direct parent traffic. Specialist ↔ specialist
  // therefore stays STAR-shaped and compliant: the child raises a `team_help`
  // request, reportFrom() delivers it to the main agent as a `[team-relay]`
  // notice (waking delivery = one new parent turn), and the main agent
  // forwards it with `team_message`, then relays the answer back.

  /** Resolve "who am I" for a child, so the main agent knows who asked. */
  const resolveSelfInstanceId = async (agent: Agent): Promise<string> => {
    const childId = String(agent.session.id)
    for (const bucket of buckets.values()) {
      for (const record of bucket.values()) {
        if (String(record.childId) === childId) return record.instanceId
      }
    }
    // Cold resume after a restart: the live registry is empty, so recover
    // the identity from the durable label via the parent's child list.
    try {
      const parentId = agent.session.header?.parentSession
      if (parentId !== undefined) {
        const children = await ctx.subagents.listChildren(parentId)
        for (const child of children) {
          if (String(child.id) !== childId) continue
          const parsed = parseInstanceLabel(child.label ?? '')
          if (parsed !== undefined) return `${parsed.identityId}#${parsed.index}`
        }
      }
    } catch {
      /* persistence unavailable — fall through */
    }
    return `child:${childId.slice(0, 8)}`
  }

  const installTeamHelpTool = (childCtx: any) => {
    const disposeSection = childCtx.systemPrompt.section({
      name: 'tool:team_help',
      order: 118, // right after the built-in report guidance (117)
      text: [
        '你需要另一位专家帮忙时（例如请 looker 读图、请 researcher 查资料），调用 team_help 求助：',
        '主代理会把请求转发给目标专家，并把对方的回复转回给你。',
        '求助必须自包含：写清目标实例 id（不确定就用身份 id，如 looker）和你要对方做什么。',
      ].join('\n'),
    })
    let disposeTool: (() => void) | undefined
    try {
      disposeTool = childCtx.tools.register(
        defineTool({
          name: 'team_help',
          description:
            'Ask another specialist for help through the main agent: name the target specialist instance id (e.g. "looker#1", a bare identity id like "looker" is fine) and a self-contained task. The main agent relays your request to the target with team_message and later relays the answer back to you as a follow-up message. Only one open request at a time; after calling, keep working or wait for the relayed answer.',
          parameters: {
            to: {
              type: 'string',
              required: true,
              description: 'Target specialist instance id, e.g. "looker#1" (a bare identity id like "looker" is also accepted).',
            },
            task: {
              type: 'string',
              required: true,
              description: 'Self-contained task for the target — everything they need to act without seeing your conversation, including shared file paths.',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                messageId: { type: 'string', required: true },
              },
            },
            render: (_args: any, value: any) => [
              { type: 'text', text: `求助已通过主代理发出（送达消息 ${value.messageId}）。目标专家的回复会以新消息转回给你。` },
            ],
          },
          async execute(args: any, exec: any) {
            const from = await resolveSelfInstanceId(exec.agent)
            const content = [
              {
                type: 'text',
                text: `[team-relay] ${from} 请求 ${args.to} 处理：${args.task}`,
              },
            ]
            return { messageId: await ctx.subagents.reportFrom(exec.agent, content, { delivery: 'wakeup', signal: exec.signal }) }
          },
        }),
      )
    } catch (error) {
      try {
        disposeSection()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'failed to register the team_help tool and roll back its prompt guidance')
      }
      throw error
    }
    return () => {
      const failures: unknown[] = []
      for (const dispose of [disposeTool, disposeSection]) {
        try {
          dispose()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'failed to revoke team_help registrations')
    }
  }

  ctx.subagents.registerContinuableSetup((childCtx: any) => installTeamHelpTool(childCtx))
}
