/**
 * Harness message → Anthropic Messages wire serialization.
 * Consecutive same-role messages merge into one wire message (Anthropic
 * forbids adjacent same-role entries). User text and image blocks become a
 * content array; assistant tool calls become `tool_use` blocks; tool
 * results become `tool_result` blocks; reasoning is dropped (the wire has
 * no assistant-side thinking input).
 * @module @dsh-collaboration/llm-anthropic/serialize
 */
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'

export interface ImageBytes {
  readonly mediaType: string
  readonly base64: string
}

export function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function toolCallName(block: ContentBlock): string {
  return block.type === 'tool-call' ? block.name : ''
}

/** Content blocks for one user-role message. */
function userBlocks(blocks: readonly ContentBlock[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const parts: unknown[] = []
  const text = flattenText(blocks)
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const resolved = images.get(block.attachment.attachmentId)
    if (resolved === undefined) continue
    parts.push({
      type: 'image',
      source: { type: 'base64', media_type: resolved.mediaType, data: resolved.base64 },
    })
  }
  return parts
}

/**
 * Serialize the conversation into Anthropic wire messages. Consecutive
 * same-role harness messages are merged; tool results ride their owning
 * user message and then become separate `tool_result` blocks.
 */
export function serializeMessages(messages: readonly Message[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const wire: unknown[] = []
  let pending: { role: 'user'; blocks: unknown[] } | undefined

  const flush = () => {
    if (pending === undefined) return
    const { role, blocks } = pending
    wire.push({ role, content: blocks.length === 1 ? blocks[0] : blocks })
    pending = undefined
  }

  for (const message of messages) {
    if (message.role === 'system') continue // handled via options.system
    if (message.role === 'assistant') {
      flush()
      const text = flattenText(message.content)
      const toolUses = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => {
          if (block.type !== 'tool-call') return undefined
          let input: unknown = {}
          try {
            input = block.arguments.length > 0 ? JSON.parse(block.arguments) : {}
          } catch {
            input = {}
          }
          return { type: 'tool_use', id: block.id, name: block.name, input }
        })
        .filter((entry) => entry !== undefined)
      if (toolUses.length > 0) {
        wire.push({
          role: 'assistant',
          content: [...(text.length > 0 ? [{ type: 'text', text }] : []), ...toolUses],
        })
      } else {
        wire.push({ role: 'assistant', content: text })
      }
      continue
    }
    // user-role message: text/image first, then tool results as blocks
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    const hasImages = message.content.some((block) => block.type === 'image')
    if (hasImages || flattenText(message.content).length > 0) {
      if (pending === undefined) pending = { role: 'user', blocks: [] }
      pending.blocks.push(...userBlocks(message.content, images))
    }
    for (const result of toolResults) {
      if (pending === undefined) pending = { role: 'user', blocks: [] }
      pending.blocks.push({
        type: 'tool_result',
        tool_use_id: result.toolCallId,
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  flush()
  return wire
}

/** Build the full wire request. Always streaming. */
export function serializeRequest(
  options: GenerateOptions,
  images: ReadonlyMap<string, ImageBytes>,
  maxTokens: number,
): unknown {
  const tools: unknown[] | undefined = options.tools?.map((tool: ToolSchema) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
  return {
    model: options.model,
    max_tokens: options.maxTokens ?? maxTokens,
    ...(options.system !== undefined ? { system: options.system } : {}),
    messages: serializeMessages(options.messages, images),
    stream: true,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.stop !== undefined ? { stop_sequences: options.stop } : {}),
  }
}

export { toolCallName }
