/**
 * `@dsh-collaboration/team`: the named specialist roster for DeepSeek Harness.
 *
 * A HOST-plane row that registers the `collaboration-team` settings namespace
 * and publishes the `collaborationTeam` service. The roster is a list of
 * agent identities — each with a stable id, a display name, a duty
 * (`role`), an optional persona, and its own provider/model — that the user
 * edits in `settings.yaml`. Collaboration tools (`tool-team`) resolve the
 * roster through the service, so a user can re-point any identity at another
 * model (or clear it back to unconfigured) without touching a preset.
 *
 * Identities with an empty `provider`/`model` FOLLOW THE SESSION MODEL (the
 * chat-box selector): the roster works with zero configuration, and a user
 * pins `provider`/`model` only for the identities that deserve their own
 * model (e.g. a vision model for `looker`).
 * @module @dsh-collaboration/team
 */
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'team'
export const inject = ['settings']

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

/** Normalize a schema-resolved agent into a TeamAgent (null → undefined). */
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

export function apply(ctx: any) {
  const scope = ctx.settings.register(NS, TeamSchema, {
    base: { agents: [...DEFAULT_ROSTER] as any },
    applies: 'live',
    validate: validateRoster,
  })

  const roster = (): TeamAgent[] => scope.get().agents?.map(toAgent) ?? []

  ctx.provide('collaborationTeam', {
    /** The current roster, resolved from settings at every call. */
    roster,
    /** Resolve one identity by id, or undefined when unknown. */
    resolve(id: string): TeamAgent | undefined {
      return roster().find((agent) => agent.id === id)
    },
    /** Whether one identity pins its own model (empty = follows the session model). */
    configured(agent: TeamAgent): boolean {
      return agent.provider !== undefined && agent.model !== undefined
    },
  })
}
