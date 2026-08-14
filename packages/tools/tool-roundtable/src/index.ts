/**
 * `roundtable` tool: parallel expert subagents, main agent as chair.
 *
 * Every expert is a full one-shot subagent on the configured provider —
 * its own model (`agentOptions.provider/model` per start), its own persona
 * (folded into the prompt), its own session. All experts run in parallel;
 * each statement comes back to the MAIN agent, which is the roundtable chair
 * and writes the synthesis in its own answer. One failing expert contributes
 * an `error` entry without failing the round.
 * @module @dsh-openagent/tool-roundtable
 */
import z from '@deepseek-ai/schemastery'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-roundtable'
export const inject = ['tools', 'subagents']

const Expert = z.object({
  name: z.string().required(),
  role: z.string().required(),
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
})

export interface RoundtableConfig {
  providerName?: string | null
  experts?: ({ name?: string | null; role?: string | null; provider?: string | null; model?: string | null; maxTokens?: number | null }[] | null)
  maxDepth?: number | null
}

export const Config: z<RoundtableConfig> = z.object({
  /** Subagent provider to convene experts on (`spawn` = fresh children). */
  providerName: z.string().default('spawn'),
  /** Default expert panel; a per-call `experts` argument replaces it. */
  experts: z.array(Expert),
  /** Absolute delegation-depth cap for the expert children. */
  maxDepth: z.number().step(1).min(0).default(0),
})

interface RawExpert {
  name: string
  role: string
  provider?: string
  model?: string
  maxTokens?: number
}

interface RawConfig {
  providerName?: string
  experts?: RawExpert[]
  maxDepth?: number
}

interface Args {
  topic: string
  background?: string
  experts?: RawExpert[]
}

const TOOL_DESCRIPTION =
  'Convene an expert roundtable: several experts — each a subagent running on its own model and persona — ' +
  'analyze one topic IN PARALLEL and return their statements. You are the chair: after the tool returns, ' +
  'synthesize the statements into one verdict in your own answer (agree, disagree, weigh trade-offs, decide). ' +
  'Use this for hard design or architecture decisions, code review from multiple angles, risk assessment, and ' +
  'adversarial checking. Experts are full subagents with workspace access; per-call `experts` replaces the ' +
  'configured panel. Every expert must name a provider and a model. One failing expert does not fail the round.'

function buildPrompt(expert: RawExpert, args: Args): string {
  const lines = [
    `You are participating in an expert roundtable as: ${expert.name}.`,
    `Your expertise and perspective: ${expert.role}`,
    ``,
    `Roundtable topic: ${args.topic}`,
  ]
  if (args.background !== undefined && args.background.trim().length > 0) {
    lines.push(``, `Background context: ${args.background}`)
  }
  lines.push(
    ``,
    `Give your expert statement: ground it in your expertise, be concrete and specific, note assumptions and uncertainties,`,
    `and take a clear position where the topic calls for one. Keep it within roughly 300-800 words.`,
    `Reply in the same language as the topic. Your statement goes directly to the roundtable chair.`,
  )
  return lines.join('\n')
}

export function apply(ctx: any, config: RawConfig) {
  ctx.tools.register(
    defineTool({
      name: 'roundtable',
      description: TOOL_DESCRIPTION,
      parameters: {
        topic: {
          type: 'string',
          required: true,
          description: 'The question or decision the roundtable addresses.',
        },
        background: {
          type: 'string',
          description: 'Optional context every expert needs (files, constraints, prior discussion).',
        },
        experts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true, description: 'Short expert name (e.g. "security-reviewer").' },
              role: { type: 'string', required: true, description: 'Persona and perspective (e.g. "A senior security engineer who finds vulnerabilities.").' },
              provider: { type: 'string', required: true, description: 'Registered provider route this expert runs on.' },
              model: { type: 'string', required: true, description: 'Model id for this expert.' },
            },
          },
          description: 'The expert panel; omitted = the configured default panel.',
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
                  name: { type: 'string', required: true },
                  provider: { type: 'string', required: true },
                  model: { type: 'string', required: true },
                  text: { type: 'string' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value: any) => {
          const lines: string[] = [`Roundtable — ${value.statements.length} expert statement(s):`]
          for (const statement of value.statements) {
            if (statement.error !== undefined) {
              lines.push(`\n### ${statement.name} (${statement.provider}/${statement.model})\nFAILED: ${statement.error}`)
            } else {
              lines.push(`\n### ${statement.name} (${statement.provider}/${statement.model})\n${statement.text}`)
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      timeoutMs: 900000,
      isConcurrencySafe: () => true,
      async execute(args: Args, exec: ToolRunContext) {
        const agent = exec.agent
        if (agent === undefined) {
          throw new Error('roundtable requires an owning agent session')
        }
        const experts = args.experts ?? config.experts
        if (experts === undefined || experts.length === 0) {
          throw new Error('roundtable: no experts — pass `experts` or configure a default panel')
        }
        const providerName = config.providerName ?? 'spawn'
        const maxDepth = config.maxDepth ?? 0

        const runExpert = async (expert: RawExpert) => {
          if (typeof expert.provider !== 'string' || expert.provider.length === 0) {
            return { name: expert.name, provider: expert.provider ?? '', model: expert.model ?? '', error: 'missing provider' }
          }
          if (typeof expert.model !== 'string' || expert.model.length === 0) {
            return { name: expert.name, provider: expert.provider, model: '', error: 'missing model' }
          }
          let run: SubagentRun
          try {
            run = await ctx.subagents.start(providerName, {
              label: `roundtable:${expert.name}`,
              prompt: [{ type: 'text', text: buildPrompt(expert, args) }],
              parent: agent,
              signal: exec.signal,
              agentOptions: {
                provider: expert.provider,
                model: expert.model,
                ...(expert.maxTokens !== undefined ? { maxTokens: expert.maxTokens } : {}),
              },
              maxDepth,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { name: expert.name, provider: expert.provider, model: expert.model, error: `start failed: ${message}` }
          }
          try {
            const result = await run.result
            const text = result.output.filter((block) => block.type === 'text').map((block) => block.text).join('')
            if (result.stopReason !== 'completed') {
              return {
                name: expert.name,
                provider: expert.provider,
                model: expert.model,
                error: `expert stopped: ${result.stopReason}${text.length > 0 ? ` — ${text.slice(0, 500)}` : ''}`,
              }
            }
            if (text.trim().length === 0) {
              return { name: expert.name, provider: expert.provider, model: expert.model, error: 'expert produced no text' }
            }
            return { name: expert.name, provider: expert.provider, model: expert.model, text }
          } finally {
            await run.dispose()
          }
        }

        const statements = await Promise.all(experts.map((expert) => runExpert(expert)))
        return { statements }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: 'Expert roundtable',
        kind: 'other',
        rawInput: { topic: args.topic, experts: args.experts },
      }),
    }),
  )
}
