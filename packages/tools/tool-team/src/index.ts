/**
 * `@dsh-collaboration/tool-team`: on-demand specialist dispatch for the main agent.
 *
 * Reads the user-configured roster from the host `collaborationTeam` service
 * (the `@dsh-collaboration/team` row) and registers two model-facing tools:
 *
 *   - `team_call`:  point one NAMED specialist at a task. The specialist runs
 *     as a one-shot subagent with its own persona and its own provider/model
 *     (from the roster; `main` inherits the session model).
 *   - `roundtable`: convene several (default: all configured) specialists on
 *     one topic in parallel; the main agent chairs the synthesis.
 *
 * A system-prompt section renders the live roster at every assembly so the
 * main agent knows who exists, what each one does, and which model each runs.
 * @module @dsh-collaboration/tool-team
 */
import z from '@deepseek-ai/schemastery'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-team'
export const inject = ['tools', 'subagents', 'collaborationTeam']

export const Config = z.object({
  /** Subagent provider the specialists run on (`spawn` = fresh children). */
  providerName: z.string().default('spawn'),
  /** Absolute delegation-depth cap for specialist children. */
  maxDepth: z.number().step(1).min(0).default(0),
})

interface RawConfig {
  providerName?: string
  maxDepth?: number
}

interface AgentRef {
  id: string
  name: string
  role: string
  persona?: string
  provider?: string
  model?: string
  maxTokens?: number
}

const TEAM_CALL_DESCRIPTION =
  'Call ONE named specialist from the team roster to handle a task, and get its answer back. ' +
  'Use this whenever the current work needs a specific expertise you do not have: point `agent` at the ' +
  'specialist id (e.g. reviewer for a security pass, looker for anything visual, debugger for a stuck bug). ' +
  'The specialist runs on its own configured model with its own duty and persona; you receive its final ' +
  'statement and stay in charge of the overall task. Pick the SINGLE best specialist per call; use ' +
  '`roundtable` when you want several perspectives at once. An unconfigured specialist reports what the ' +
  'user must fill in settings.yaml.'

const ROUNDTABLE_DESCRIPTION =
  'Convene several specialists from the team roster IN PARALLEL on one topic and collect their statements. ' +
  'You are the chair: after this tool returns, synthesize the statements into one verdict in your own answer. ' +
  'Omit `agents` to convene every configured specialist. One failing specialist does not fail the round.'

function buildPrompt(agent: AgentRef, task: string, extra: string | undefined): string {
  const lines = [
    `你是主代理团队中的专项专家：${agent.name}（${agent.id}）。`,
    `你的职责：${agent.role}`,
  ]
  if (agent.persona !== undefined && agent.persona.length > 0) lines.push(`你的行事风格：${agent.persona}`)
  lines.push(``, `任务：${task}`)
  if (extra !== undefined && extra.trim().length > 0) lines.push(``, `背景与要求：${extra}`)
  lines.push(``, `直接给出你的专业结论，简洁、具体、可执行。回复语言跟随任务所用语言。`)
  return lines.join('\n')
}

function renderRoster(roster: AgentRef[]): string {
  const lines: string[] = [
    '## 专家团队名册（dsh-collaboration）',
    '你是团队主代理。需要专项能力时，用 `team_call` 点名一位专家；需要多视角评估时，用 `roundtable` 召集多位专家并行发言。',
    '当前名册：',
  ]
  for (const agent of roster) {
    const model =
      agent.id === 'main'
        ? '（本会话主模型）'
        : agent.provider !== undefined && agent.model !== undefined
          ? `（${agent.provider}/${agent.model}）`
          : '（未配置模型，调用会报错——用户需在 settings.yaml 的 collaboration-team 段配置）'
    lines.push(`- ${agent.id} — ${agent.name}${model}：${agent.role}`)
  }
  return lines.join('\n')
}

function formatRosterIds(roster: AgentRef[]): string {
  return roster.map((agent) => agent.id).join(', ')
}

export function apply(ctx: any, config: RawConfig) {
  const providerName = config.providerName ?? 'spawn'
  const maxDepth = config.maxDepth ?? 0

  const roster = (): AgentRef[] => {
    const service = ctx.collaborationTeam
    if (service === undefined) return []
    const list = service.roster()
    return Array.isArray(list) ? list : []
  }

  const resolveAgent = (id: string): AgentRef => {
    const found = roster().find((agent) => agent.id === id)
    if (found === undefined) {
      throw new Error(`未知专家 "${id}"。当前名册：${formatRosterIds(roster())}。`)
    }
    if (id !== 'main' && (found.provider === undefined || found.model === undefined)) {
      throw new Error(
        `专家 "${found.name}（${id}）" 尚未配置模型：请在 settings.yaml 的 collaboration-team 段为该身份设置 provider 与 model（例如 provider: zhipu, model: glm-4v-flash）。`,
      )
    }
    return found
  }

  const runOne = async (agent: AgentRef, prompt: string, exec: ToolRunContext) => {
    const parent = exec.agent
    if (parent === undefined) throw new Error('team tools require an owning agent session')
    let run: SubagentRun
    try {
      run = await ctx.subagents.start(providerName, {
        label: `team:${agent.id}`,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: exec.signal,
        ...(agent.id !== 'main'
          ? {
              agentOptions: {
                provider: agent.provider,
                model: agent.model,
                ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
              },
            }
          : {}),
        maxDepth,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`启动专家 "${agent.name}（${agent.id}）" 失败：${message}`)
    }
    try {
      const result = await run.result
      const text = result.output.filter((block) => block.type === 'text').map((block) => block.text).join('')
      if (result.stopReason !== 'completed') {
        throw new Error(`专家 "${agent.name}（${agent.id}）" 未正常完成：${result.stopReason}${text.length > 0 ? ` — ${text.slice(0, 500)}` : ''}`)
      }
      if (text.trim().length === 0) {
        throw new Error(`专家 "${agent.name}（${agent.id}）" 没有产出内容`)
      }
      return text
    } finally {
      await run.dispose()
    }
  }

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'dsh-collaboration:team-roster',
      order: 150,
      text: () => renderRoster(roster()),
    })
  }

  ctx.tools.register(
    defineTool({
      name: 'team_call',
      description: TEAM_CALL_DESCRIPTION,
      parameters: {
        agent: {
          type: 'string',
          required: true,
          description: 'The specialist id from the team roster (e.g. reviewer, debugger, looker, painter).',
        },
        task: {
          type: 'string',
          required: true,
          description: 'The task for this specialist, stated completely — it works standalone.',
        },
        context: {
          type: 'string',
          description: 'Optional extra context the specialist needs (files, constraints, prior discussion).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            agent: { type: 'string', required: true },
            answer: { type: 'string', required: true },
          },
        },
        render: (_args, value: any) => [{ type: 'text', text: value.answer }],
      },
      timeoutMs: 900000,
      isConcurrencySafe: () => true,
      async execute(args: { agent: string; task: string; context?: string }, exec: ToolRunContext) {
        const agent = resolveAgent(args.agent)
        const answer = await runOne(agent, buildPrompt(agent, args.task, args.context), exec)
        return { agent: agent.id, answer }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: `调用专家：${args.agent}`,
        kind: 'other',
        rawInput: { task: args.task },
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'roundtable',
      description: ROUNDTABLE_DESCRIPTION,
      parameters: {
        topic: {
          type: 'string',
          required: true,
          description: 'The question or decision the roundtable addresses.',
        },
        agents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specialist ids to convene; omitted = every configured specialist (main excluded).',
        },
        background: {
          type: 'string',
          description: 'Optional context every specialist needs.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            statements: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  text: { type: 'string' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value: any) => {
          const lines: string[] = [`圆桌讨论 — ${value.statements.length} 位专家发言：`]
          for (const statement of value.statements) {
            if (statement.error !== undefined) {
              lines.push(`\n### ${statement.name}（${statement.id}）\n失败：${statement.error}`)
            } else {
              const route = statement.provider !== undefined ? `（${statement.provider}/${statement.model}）` : ''
              lines.push(`\n### ${statement.name}${route}\n${statement.text}`)
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      timeoutMs: 900000,
      isConcurrencySafe: () => true,
      async execute(args: { topic: string; agents?: string[]; background?: string }, exec: ToolRunContext) {
        const all = roster().filter((agent) => agent.id !== 'main')
        const selected =
          args.agents !== undefined && args.agents.length > 0
            ? args.agents.map((id) => {
                const found = all.find((agent) => agent.id === id)
                if (found === undefined) throw new Error(`未知专家 "${id}"。当前名册：${formatRosterIds(all)}。`)
                return found
              })
            : all.filter((agent) => agent.provider !== undefined && agent.model !== undefined)
        if (selected.length === 0) {
          throw new Error('roundtable: 没有可召集的专家——名册里没有任何已配置模型的专家（main 除外）。')
        }
        const statements = await Promise.all(
          selected.map(async (agent) => {
            try {
              const text = await runOne(agent, buildPrompt(agent, `圆桌议题：${args.topic}`, args.background), exec)
              return { id: agent.id, name: agent.name, provider: agent.provider ?? '', model: agent.model ?? '', text }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return { id: agent.id, name: agent.name, provider: agent.provider ?? '', model: agent.model ?? '', error: message }
            }
          }),
        )
        return { statements }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: '专家圆桌',
        kind: 'other',
        rawInput: { topic: args.topic, agents: args.agents },
      }),
    }),
  )
}
