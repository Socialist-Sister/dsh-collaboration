/**
 * `@dsh-collaboration/tool-team`: the main agent's team console.
 *
 * Reads the user-configured roster AND the live instance registry from the
 * host `collaborationTeam` service (the `@dsh-collaboration/team` row) and
 * registers the team tools:
 *
 *   - `team_call`:   hire one or more PERSISTENT specialist instances from a
 *     roster identity (`instances` clones the same identity for parallel
 *     tasks); `wait: true` degrades to the v0.1 foreground one-shot.
 *   - `team_message`: main → instance follow-up (STAR topology: specialist
 *     ↔ specialist talk is relayed through the main agent).
 *   - `team_status`:  live instance board (who is working / settled).
 *   - `team_close`:   interrupt one instance.
 *   - `roundtable`:   unchanged one-shot parallel panel.
 *
 * Specialists answer through their built-in `report` tool and the
 * continuation manager notifies the main agent when an instance settles.
 * A system-prompt section renders the live roster plus the current working
 * set at every assembly.
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
  /**
   * Absolute delegation-depth cap for specialist children. Must be >= 1:
   * the main agent's child runs at depth 1. `1` (default) means specialists
   * may not delegate further.
   */
  maxDepth: z.number().step(1).min(1).default(1),
  /**
   * Roster prompt verbosity. `lean` (default) = one compact line per
   * identity; `full` = identity + duty text; `off` = no roster section
   * (tool descriptions carry the essentials). Lower verbosity = better
   * model performance on long sessions.
   */
  rosterPrompt: z.union(['full', 'lean', 'off']).default('lean'),
})

interface RawConfig {
  providerName?: string
  maxDepth?: number
  rosterPrompt?: 'full' | 'lean' | 'off'
}

interface AgentRef {
  id: string
  name: string
  role: string
  persona?: string
  provider?: string
  model?: string
  maxTokens?: number
  toolFilter?: { allow?: string[]; deny?: string[] }
}

interface InstanceRef {
  instanceId: string
  identityId: string
  name: string
  childId: string
  label: string
  createdAt: number
  status?: 'working' | 'settled'
}

const TEAM_CALL_DESCRIPTION =
  'Hire persistent specialists from the team roster as background teammates (each has its own session and reports via `report`; you get a settlement notice when one finishes). ' +
  '`tasks` hires one clone per entry with distinct work; `instances` clones the same task; `wait: true` = one-shot blocking call returning the answer directly (no instance). ' +
  'Manage hired instances with `team_message` (follow-up/relay), `team_status` (board), `team_close` (dismiss). A specialist without a pinned model follows the session model.'

const TEAM_MESSAGE_DESCRIPTION =
  'Send one message to a hired specialist instance (e.g. reviewer#1); it wakes and answers via `report`. ' +
  'Star topology: specialists do not message each other directly — relay through you. Dismissed instances refuse delivery.'

const TEAM_STATUS_DESCRIPTION =
  'Show the live team board: every hired instance (id, identity, status working/settled/dismissed). Check it before messaging or closing instances.'

const TEAM_CLOSE_DESCRIPTION =
  'Dismiss one hired instance by id (e.g. reviewer#1): its turn stops, team_message deliveries are refused, and team_status marks it dismissed. Unknown ids fail loudly.'

const ROUNDTABLE_DESCRIPTION =
  'Convene roster specialists IN PARALLEL on one topic and collect their statements; synthesize the verdict yourself. Omit `agents` for every specialist; one failure does not fail the round.'

function formatRosterIds(roster: AgentRef[]): string {
  return roster.map((agent) => agent.id).join(', ')
}

function renderTeam(roster: AgentRef[], working: InstanceRef[], mode: 'full' | 'lean' | 'off'): string {
  if (mode === 'off') return ''
  const lines: string[] = [
    '## 专家团队（dsh-collaboration）',
    '你是团队主代理，**更倾向于分配任务而非亲自动手**：把思考、审查、调研、写作交给专家，你负责拆解、调度与综合决策。' +
      'hire 专家用 `team_call`（`instances` 可雇佣多个分身）；跟进/追问用 `team_message`；' +
      '查看谁在线用 `team_status`；解雇用 `team_close`。专家完成任务会用 report 汇报，结算时你会收到通知。' +
      '专家之间不直接通话——需要转达就用 `team_message` 以你的名义转发。',
    '',
    '名册（模板）：',
  ]
  for (const agent of roster) {
    const model =
      agent.provider !== undefined && agent.model !== undefined
        ? `（${agent.provider}/${agent.model}）`
        : agent.id === 'main'
          ? '（本会话主模型）'
          : '（跟随主模型）'
    lines.push(mode === 'full' ? `- ${agent.id} — ${agent.name}${model}：${agent.role}` : `- ${agent.id} — ${agent.name}${model}`)
  }
  if (working.length > 0) {
    lines.push('', '当前在线实例：')
    for (const instance of working) {
      lines.push(`- ${instance.instanceId}（${instance.name}，${instance.status ?? 'working'}）`)
    }
  }
  return lines.join('\n')
}

export function apply(ctx: any, config: RawConfig) {
  const providerName = config.providerName ?? 'spawn'
  const maxDepth = config.maxDepth ?? 1
  const rosterPrompt = config.rosterPrompt ?? 'lean'

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
    return found
  }

  const requireParent = (exec: ToolRunContext) => {
    const parent = exec.agent
    if (parent === undefined) throw new Error('team tools require an owning agent session')
    return parent
  }

  /** v0.1 one-shot foreground path (wait mode). */
  const runOne = async (agent: AgentRef, task: string, extra: string | undefined, exec: ToolRunContext) => {
    const parent = requireParent(exec)
    const prompt = ctx.collaborationTeam.promptFor(agent, task, extra)
    let run: SubagentRun
    try {
      run = await ctx.subagents.start(providerName, {
        label: `team:${agent.id}`,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: exec.signal,
        ...(agent.provider !== undefined && agent.model !== undefined
          ? {
              agentOptions: {
                provider: agent.provider,
                model: agent.model,
                ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
              },
            }
          : {}),
        ...(agent.toolFilter !== undefined ? { toolFilter: agent.toolFilter } : {}),
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
      text: (context: any) => {
        const parentId = context?.agent?.session?.id
        // workingSet is a service FUNCTION (not an array): call it first, then
        // guard the result. Also stay compatible with a missing collaborationTeam service.
        const workingSet = ctx.collaborationTeam?.workingSet
        const snapshot = typeof workingSet === 'function' ? workingSet(parentId) : undefined
        const working = Array.isArray(snapshot) ? snapshot : []
        return renderTeam(roster(), working, rosterPrompt)
      },
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
          description: 'The specialist identity id from the team roster (e.g. reviewer, debugger, looker, painter).',
        },
        task: {
          type: 'string',
          required: true,
          description: 'The task for this specialist (all clones), stated completely — it works standalone. When `tasks` is provided, this field is only the fallback description.',
        },
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional per-clone tasks: hiring one clone per entry, each getting its own task (e.g. ["审查认证模块", "审查支付模块"] hires reviewer#1 and reviewer#2 with different work). Overrides `instances`; only meaningful when wait is false.',
        },
        context: {
          type: 'string',
          description: 'Optional extra context the specialist needs (files, constraints, prior discussion).',
        },
        instances: {
          type: 'integer',
          description: 'How many clones of this identity to hire (default 1). Each clone gets its own task session and an id like reviewer#1, reviewer#2. Only meaningful when wait is false.',
        },
        wait: {
          type: 'boolean',
          description: 'true = one-shot foreground call that blocks and returns the answer (instances must be 1); false (default) = hire persistent background specialists and get instance ids back.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            instances: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  instanceId: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                },
              },
            },
            answer: { type: 'string' },
          },
        },
        render: (_args, value: any) => {
          if (value.answer !== undefined && value.answer.length > 0) {
            return [{ type: 'text', text: value.answer }]
          }
          const ids = value.instances.map((entry: any) => entry.instanceId).join(', ')
          return [{ type: 'text', text: `已雇佣专家实例：${ids}。他们会用 report 汇报，完成后你会收到通知；用 team_message 跟进，team_status 看状态。` }]
        },
      },
      timeoutMs: 900000,
      isConcurrencySafe: () => true,
      async execute(args: { agent: string; task: string; tasks?: string[]; context?: string; instances?: number; wait?: boolean }, exec: ToolRunContext) {
        const parent = requireParent(exec)
        const agent = resolveAgent(args.agent)
        const perCloneTasks = Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks : undefined
        const cloneCount = perCloneTasks !== undefined ? perCloneTasks.length : args.instances ?? 1
        if (!Number.isInteger(cloneCount) || cloneCount < 1 || cloneCount > 10) {
          throw new Error('team_call: 分身数量必须是 1-10 的整数')
        }
        if (args.wait === true) {
          if (cloneCount !== 1 || perCloneTasks !== undefined) throw new Error('team_call: wait 模式只能雇佣 1 个实例且不支持 tasks 列表')
          const answer = await runOne(agent, args.task, args.context, exec)
          // F5: a one-shot call is NOT a persistent instance — return an empty
          // instance list plus the answer, never an addressable instance id.
          return { instances: [], answer }
        }
        const hired: { instanceId: string; name: string }[] = []
        for (let i = 0; i < cloneCount; i++) {
          const task = perCloneTasks !== undefined ? perCloneTasks[i] : args.task
          const record = await ctx.collaborationTeam.spawn(parent, agent.id, task, {
            ...(args.context !== undefined ? { context: args.context } : {}),
            signal: exec.signal,
            maxDepth,
          })
          hired.push({ instanceId: record.instanceId, name: record.name })
        }
        return { instances: hired }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: `雇佣专家：${args.agent}${args.instances !== undefined && args.instances > 1 ? ` ×${args.instances}` : ''}`,
        kind: 'other',
        rawInput: { task: args.task },
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'team_message',
      description: TEAM_MESSAGE_DESCRIPTION,
      parameters: {
        to: {
          type: 'string',
          required: true,
          description: 'The specialist instance id (e.g. reviewer#1). Check team_status for live ids.',
        },
        message: {
          type: 'string',
          required: true,
          description: 'The follow-up message (question, revision request, or a relayed message from another specialist).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            instanceId: { type: 'string', required: true },
            delivered: { type: 'boolean', required: true },
          },
        },
        // execute throws on failure, so `delivered` is always true here — the
        // failure branch was unreachable dead code and has been removed.
        render: (_args, value: any) => [{ type: 'text', text: `已发送给 ${value.instanceId}。` }],
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      async execute(args: { to: string; message: string }, exec: ToolRunContext) {
        const parent = requireParent(exec)
        try {
          await ctx.collaborationTeam.followup(parent, args.to, args.message, exec.signal)
          return { instanceId: args.to, delivered: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(message)
        }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: `发消息给 ${args.to}`,
        kind: 'other',
        rawInput: { message: args.message },
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'team_status',
      description: TEAM_STATUS_DESCRIPTION,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            instances: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  instanceId: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  identityId: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value: any) => {
          if (value.instances.length === 0) return [{ type: 'text', text: '当前没有雇佣任何专家实例。' }]
          const labels: Record<string, string> = { working: '工作中', settled: '已完成', dismissed: '已解散' }
          const lines = value.instances.map((entry: any) => `- ${entry.instanceId}（${entry.name}）：${labels[entry.status] ?? entry.status}`)
          return [{ type: 'text', text: `专家实例（${value.instances.length}）：\n` + lines.join('\n') }]
        },
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(_args: {}, exec: ToolRunContext) {
        const parent = requireParent(exec)
        const views = await ctx.collaborationTeam.instances(parent)
        return {
          instances: views.map((entry: InstanceRef) => ({
            instanceId: entry.instanceId,
            name: entry.name,
            identityId: entry.identityId,
            status: entry.status ?? 'working',
          })),
        }
      },
      presentCall: () => ({ card: 'generic', title: '团队状态', kind: 'other', rawInput: {} }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'team_close',
      description: TEAM_CLOSE_DESCRIPTION,
      parameters: {
        instance: {
          type: 'string',
          required: true,
          description: 'The specialist instance id to dismiss (e.g. reviewer#1).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            instanceId: { type: 'string', required: true },
            closed: { type: 'boolean', required: true },
          },
        },
        render: (_args, value: any) => [{ type: 'text', text: `已解散 ${value.instanceId}——它不再接收消息，面板中标记为已解散。` }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args: { instance: string }, exec: ToolRunContext) {
        const parent = requireParent(exec)
        try {
          await ctx.collaborationTeam.close(parent, args.instance)
          return { instanceId: args.instance, closed: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(message)
        }
      },
      presentCall: (args: any) => ({ card: 'generic', title: `解雇 ${args.instance}`, kind: 'other', rawInput: {} }),
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
          description: 'Specialist ids to convene; omitted = every specialist (main excluded).',
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
            : all
        if (selected.length === 0) {
          throw new Error('roundtable: 没有可召集的专家——名册里没有任何专家（main 除外）。')
        }
        const statements = await Promise.all(
          selected.map(async (agent) => {
            try {
              const text = await runOne(agent, `圆桌议题：${args.topic}`, args.background, exec)
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
