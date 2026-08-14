/**
 * `model_compare` tool: one prompt, several models, answers side by side.
 *
 * Each entry is a raw streaming `llm.stream` call (no subagent, no tools —
 * pure model comparison). All models run in parallel; one failing model
 * contributes an `error` entry without failing the others.
 * @module @dsh-openagent/tool-model-compare
 */
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-model-compare'
export const inject = ['tools', 'llm']

const ModelEntry = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  label: z.string(),
})

export interface ModelCompareConfig {
  models?: ({ provider?: string | null; model?: string | null; label?: string | null }[] | null)
  maxTokens?: number | null
  system?: string | null
}

export const Config: z<ModelCompareConfig> = z.object({
  /** Default comparison set; a per-call `models` argument replaces it. */
  models: z.array(ModelEntry),
  /** Output-token cap for every comparison call. */
  maxTokens: z.number().step(1).min(1).default(3000),
  /** Optional system prompt for every comparison call. */
  system: z.string(),
})

interface RawModel {
  provider: string
  model: string
  label?: string
}

interface RawConfig {
  models?: RawModel[]
  maxTokens?: number
  system?: string
}

interface Args {
  prompt: string
  system?: string
  models?: RawModel[]
}

const TOOL_DESCRIPTION =
  'Send the SAME prompt to several models in parallel and return every answer side by side. ' +
  'Use this to compare how different providers/models answer one question, pick the best answer, ' +
  'or aggregate several perspectives. Pure model calls: the compared models get no tools and no ' +
  'workspace access. Prefer subagent tools for real work; use this for quality comparison and ' +
  'second opinions.'

export function apply(ctx: any, config: RawConfig) {
  ctx.tools.register(
    defineTool({
      name: 'model_compare',
      description: TOOL_DESCRIPTION,
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'The exact prompt sent to every model.',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt override for this call.',
        },
        models: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              provider: { type: 'string', required: true, description: 'Registered provider route (e.g. openai, anthropic, gemini, deepseek-official).' },
              model: { type: 'string', required: true, description: 'Model id accepted by that provider.' },
              label: { type: 'string', description: 'Optional display label for the result.' },
            },
          },
          description: 'Models to compare; omitted = the configured default set.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            results: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string', required: true },
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
          const lines: string[] = [`Model comparison — ${value.results.length} result(s):`]
          for (const result of value.results) {
            if (result.error !== undefined) {
              lines.push(`\n### ${result.label} (${result.provider}/${result.model})\nERROR: ${result.error}`)
            } else {
              lines.push(`\n### ${result.label} (${result.provider}/${result.model})\n${result.text}`)
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      timeoutMs: 600000,
      isConcurrencySafe: () => true,
      async execute(args: Args, exec: ToolRunContext) {
        const models = args.models ?? config.models
        if (models === undefined || models.length === 0) {
          throw new Error('model_compare: no models to compare — pass `models` or configure a default set')
        }
        const system = args.system ?? config.system
        const maxTokens = config.maxTokens ?? 3000

        const results = await Promise.all(
          models.map(async (entry) => {
            const label = entry.label ?? `${entry.provider}/${entry.model}`
            try {
              const message = createUserMessage({
                content: [{ type: 'text', text: args.prompt }],
                source: { kind: 'user' },
              })
              let text = ''
              for await (const chunk of ctx.llm.stream({
                provider: entry.provider,
                model: entry.model,
                messages: [message],
                ...(system !== undefined && system.length > 0 ? { system } : {}),
                maxTokens,
                signal: exec.signal,
              })) {
                if (chunk.type === 'text-delta') text += chunk.text
              }
              if (text.trim().length === 0) {
                return { label, provider: entry.provider, model: entry.model, error: 'model returned no text' }
              }
              return { label, provider: entry.provider, model: entry.model, text }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return { label, provider: entry.provider, model: entry.model, error: message }
            }
          }),
        )
        return { results }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: 'Compare models',
        kind: 'other',
        rawInput: { prompt: args.prompt, models: args.models },
      }),
    }),
  )
}
