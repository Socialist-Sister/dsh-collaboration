/**
 * Harness message → OpenAI chat-completions wire serialization.
 * User text becomes `content`; when a user message carries image blocks its
 * content becomes a part array with `image_url` data URLs. Assistant tool
 * calls become `tool_calls`; tool results become standalone `role: 'tool'`
 * messages. Assistant reasoning has no OpenAI chat-completions equivalent
 * and is omitted. Unknown declaration-merged block types fall through as
 * text-only content.
 * @module @dsh-collaboration/llm-openai-compatible/serialize
 */
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'

/** Resolved bytes for one image block, keyed by attachment id. */
export interface ImageBytes {
  readonly mediaType: string
  readonly base64: string
}

/** Join the text blocks of a message (used for user/tool-result content). */
export function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Build an OpenAI content part array for one message's blocks. */
function userParts(blocks: readonly ContentBlock[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const parts: unknown[] = []
  const text = flattenText(blocks)
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const resolved = images.get(block.attachment.attachmentId)
    if (resolved === undefined) continue
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${resolved.mediaType};base64,${resolved.base64}` },
    })
  }
  return parts
}

/** Serialize one assistant message (text + tool calls). */
function serializeAssistant(message: Message): unknown {
  const text = flattenText(message.content)
  const toolCalls = message.content
    .filter((block) => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    content: text,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages after their owning user message's text.
 * @param messages - the harness conversation, in order.
 * @param images - attachment id → resolved image bytes.
 */
export function serializeMessages(messages: readonly Message[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const wire: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    const hasImages = message.content.some((block) => block.type === 'image')
    if (hasImages) {
      wire.push({ role: 'user', content: userParts(message.content, images) })
    } else {
      const text = flattenText(message.content)
      if (text.length > 0 || toolResults.length === 0) wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({ role: 'tool', tool_call_id: result.toolCallId, content: flattenText(result.content) || '(no output)' })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted so provider defaults apply.
 */
export function serializeRequest(options: GenerateOptions, images: ReadonlyMap<string, ImageBytes>): unknown {
  const messages: unknown[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...serializeMessages(options.messages, images))
  const tools: unknown[] | undefined = options.tools?.map((tool: ToolSchema) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
  }
}
