/**
 * `vision` tool: the multimodal bridge for text-only main agents.
 *
 * The calling agent (typically a DeepSeek model that cannot see images) asks
 * a configured vision-capable provider/model about one or more workspace
 * images. The tool reads the image bytes, stores them as durable image
 * attachments, builds a proper harness user message with image blocks, and
 * streams one model call through the configured adapter — which serializes
 * images into that provider's wire format. The text answer comes back to the
 * main agent, which keeps working from it.
 * @module @dsh-openagent/tool-vision
 */
import z from '@deepseek-ai/schemastery'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-vision'
export const inject = ['tools', 'llm']

export interface VisionConfig {
  provider?: string | null
  model?: string | null
  maxTokens?: number | null
  system?: string | null
}

export const Config: z<VisionConfig> = z.object({
  /** Default provider route; per-call `provider` overrides it. */
  provider: z.string().default('gemini'),
  /** Default model id; per-call `model` overrides it. */
  model: z.string().default('gemini-2.5-flash'),
  /** Output-token cap for the vision call. */
  maxTokens: z.number().step(1).min(1).default(4096),
  /** Optional system prompt for the vision call. */
  system: z.string(),
})

interface RawConfig {
  provider?: string
  model?: string
  maxTokens?: number
  system?: string
}

interface ImageArg {
  path: string
}

interface Args {
  images: ImageArg[]
  question: string
  provider?: string
  model?: string
}

const TOOL_DESCRIPTION =
  'Ask a vision-capable model about images. Use this when the user or the task involves images, ' +
  'screenshots, charts, UI mockups, photos, or scanned documents that you (a text-only model) cannot see directly. ' +
  'Point `images` at workspace file paths (PNG/JPEG/WebP/GIF). The tool sends each image to the configured vision ' +
  'model together with `question` and returns that model\'s text analysis, so you can continue working from it. ' +
  'Do not use it for text that you can read with the read tool.'

function mediaTypeOf(path: string): ImageMediaType | undefined {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return undefined
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export function apply(ctx: any, config: RawConfig) {
  const resolveCwd = (exec: ToolRunContext): string | undefined => {
    const agent = exec.agent
    if (agent !== undefined) {
      const cwd = agent.session.header.cwd
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    }
    const sandboxPolicy = ctx.get('sandboxPolicy')
    return sandboxPolicy?.workspaceRoot
  }

  ctx.tools.register(
    defineTool({
      name: 'vision',
      description: TOOL_DESCRIPTION,
      parameters: {
        images: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: {
                type: 'string',
                required: true,
                description: 'Workspace file path of an image (PNG/JPEG/WebP/GIF); relative paths resolve against the session workspace.',
              },
            },
          },
          description: 'The images to analyze.',
        },
        question: {
          type: 'string',
          required: true,
          description: 'What to ask the vision model about the images (e.g. describe the chart, extract the text, review this UI screenshot).',
        },
        provider: {
          type: 'string',
          description: `Optional provider route override (default: ${config.provider ?? 'gemini'}). Must be a registered adapter with a vision-capable model.`,
        },
        model: {
          type: 'string',
          description: `Optional model override (default: ${config.model ?? 'gemini-2.5-flash'}).`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string', required: true },
          },
        },
        render: (_args, value: any) => [{ type: 'text', text: value.answer }],
      },
      timeoutMs: 300000,
      isConcurrencySafe: () => true,
      async execute(args: Args, exec: ToolRunContext) {
        if (!Array.isArray(args.images) || args.images.length === 0) {
          throw new Error('vision: at least one image path is required')
        }
        for (const entry of args.images) {
          if (mediaTypeOf(entry.path) === undefined) {
            throw new Error(`vision: unsupported image type for "${entry.path}" (expected .png/.jpg/.jpeg/.webp/.gif)`)
          }
        }
        const attachments = ctx.get('attachments')
        const fs = ctx.get('fs')
        if (attachments === undefined) {
          throw new Error('vision requires the attachments service; this deployment does not provide one')
        }
        if (fs === undefined) {
          throw new Error('vision requires the fs service; this deployment does not provide one')
        }
        const cwd = resolveCwd(exec)
        const maxImageBytes = attachments.imageLimits?.maxImageBytes ?? 16 * 1024 * 1024

        const refs = []
        for (const entry of args.images) {
          const mediaType = mediaTypeOf(entry.path)!
          const target = await fs.resolve(entry.path, {
            ...(cwd !== undefined ? { cwd } : {}),
            signal: exec.signal,
          })
          const data = await fs.readBytes(target, exec.signal, maxImageBytes)
          const saved = await attachments.saveImage({ data, mediaType, name: baseName(entry.path) })
          refs.push(saved)
        }

        const provider = args.provider ?? config.provider ?? 'gemini'
        const model = args.model ?? config.model ?? 'gemini-2.5-flash'
        const message = createUserMessage({
          content: [
            { type: 'text', text: args.question },
            ...refs.map((ref) => ({ type: 'image' as const, attachment: ref })),
          ],
          source: { kind: 'user' },
        })

        let answer = ''
        for await (const chunk of ctx.llm.stream({
          provider,
          model,
          messages: [message],
          ...(config.system !== undefined && config.system.length > 0 ? { system: config.system } : {}),
          maxTokens: config.maxTokens ?? 4096,
          signal: exec.signal,
        })) {
          if (chunk.type === 'text-delta') answer += chunk.text
        }
        if (answer.trim().length === 0) {
          throw new Error('vision: the vision model returned no text')
        }
        return { answer }
      },
      presentCall: (args: any) => ({
        card: 'generic',
        title: 'Vision analysis',
        kind: 'other',
        rawInput: { images: args.images.map((entry: ImageArg) => entry.path), question: args.question },
      }),
    }),
  )
}
