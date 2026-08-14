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
 * routed through the main agent (the chat coordinator), never direct.
 *
 * Identities with an empty `provider`/`model` FOLLOW THE SESSION MODEL (the
 * chat-box selector): the roster works with zero configuration, and a user
 * pins `provider`/`model` only for the identities that deserve their own
 * model (e.g. a vision model for `looker`).
 * @module @dsh-collaboration/team
 */
import z from '@deepseek-ai/schemastery'
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
    role: '当前会话的主代理（也就是你），统筹全局、拆解任务、推进交付；在需要专项能力时点名调用其他专家，并综合各方结论。',
  },
  {
    id: 'planner',
    name: '规划师',
    role: '把复杂目标拆解为可执行的步骤与里程碑，明确依赖、顺序和验收标准。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'coder',
    name: '工程师',
    role: '编写实现代码、落地功能、修复缺陷，遵循项目现有风格与约定。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'debugger',
    name: '调试员',
    role: '定位 bug、分析报错与日志、给出最小可复现与修复方案。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'reviewer',
    name: '审查员',
    role: '审查代码与方案，找出安全漏洞、边界条件、性能与可维护性风险。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'researcher',
    name: '研究员',
    role: '检索资料、调研技术与竞品、核实事实，输出有出处的结论。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'critic',
    name: '评论家',
    role: '以独立视角挑刺：质疑假设、寻找盲点、模拟反对者，帮方案变得更稳。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'writer',
    name: '写手',
    role: '撰写文档、报告、README 与文案，语言准确、结构清晰。',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'looker',
    name: '观察员',
    role: '看图、截图与 UI 的多模态分析：描述布局、提取文字、指出视觉问题。',
  },
  {
    id: 'painter',
    name: '画家',
    role: '图像创作与生成：根据需求描述产出或构思视觉素材。',
  },
]

const AgentSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
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
  /** Synchronous snapshot of instances hired in this process (for prompt sections). */
  workingSet(): TeamInstance[]
}

function toAgent(entry: any): TeamAgent {
  return {
    id: entry.id ?? '',
    name: entry.name ?? entry.id ?? '',
    role: entry.role ?? '',
    ...(entry.persona !== undefined && entry.persona !== null && entry.persona.length > 0 ? { persona: entry.persona } : {}),
    ...(entry.provider !== undefined && entry.provider !== null && entry.provider.length > 0 ? { provider: entry.provider } : {}),
    ...(entry.model !== undefined && entry.model !== null && entry.model.length > 0 ? { model: entry.model } : {}),
    ...(entry.maxTokens !== undefined && entry.maxTokens !== null ? { maxTokens: entry.maxTokens } : {}),
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
  const registry = new Map<string, LiveRecord>()
  const counters = new Map<string, number>()
  /** Instance ids dismissed through label recovery (not in the live registry). */
  const dismissedRecovered = new Set<string>()

  const workingSet = (): TeamInstance[] => [...registry.values()]

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

  const isDismissed = (instanceId: string): boolean => {
    const hit = registry.get(instanceId)
    return (hit?.dismissed ?? false) || dismissedRecovered.has(instanceId)
  }

  const resolveChildId = async (parent: Agent, instanceId: string): Promise<SessionId> => {
    const hit = registry.get(instanceId)
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
    const index = (counters.get(identityId) ?? 0) + 1
    counters.set(identityId, index)
    const instanceId = `${identityId}#${index}`
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
        maxDepth: 1,
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
    registry.set(instanceId, record)
    return record
  }

  const followup: TeamService['followup'] = async (parent, instanceId, message, signal) => {
    if (isDismissed(instanceId)) {
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
    const hit = registry.get(instanceId)
    if (hit !== undefined) {
      hit.dismissed = true
    } else {
      dismissedRecovered.add(instanceId)
    }
  }

  const instances: TeamService['instances'] = async (parent) => {
    const views = new Map<string, TeamInstanceView>()
    for (const record of registry.values()) {
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
      const status = dismissedRecovered.has(record.instanceId) ? 'dismissed' : live === undefined ? 'settled' : 'working'
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
}
