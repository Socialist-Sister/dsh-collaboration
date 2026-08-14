/**
 * Harness message → Gemini `streamGenerateContent` wire serialization.
 * User turns carry text and `inlineData` image parts; assistant turns carry
 * text and `functionCall` parts; tool results become `functionResponse`
 * parts in a user-role turn. Gemini has no tool-call id, so this adapter
 * mints ids of the shape `<name>#<n>` — the function name stays recoverable
 * from the id, which is how `functionResponse.name` correlates. Reasoning
 * has no Gemini input equivalent and is omitted.
 * @module @dsh-openagent/llm-gemini/serialize
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

/** The function name embedded in a synthetic call id (`<name>#<n>`). */
export function callIdName(callId: string): string {
  const index = callId.lastIndexOf('#')
  return index > 0 ? callId.slice(0, index) : callId
}

/** Build the part list for one user-role message. */
function userParts(blocks: readonly ContentBlock[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const parts: unknown[] = []
  const text = flattenText(blocks)
  if (text.length > 0) parts.push({ text })
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const resolved = images.get(block.attachment.attachmentId)
    if (resolved === undefined) continue
    parts.push({
      inlineData: { mimeType: resolved.mediaType, data: resolved.base64 },
    })
  }
  return parts
}

/** Parse a tool-result block's text into a JSON value, or fall back to text. */
function resultValue(block: ContentBlock): unknown {
  if (block.type !== 'tool-result') return undefined
  const text = flattenText(block.content)
  try {
    return JSON.parse(text)
  } catch {
    return text || '(no output)'
  }
}

/** Serialize the conversation into Gemini `contents`. */
export function serializeMessages(messages: readonly Message[], images: ReadonlyMap<string, ImageBytes>): unknown[] {
  const wire: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') continue // handled via systemInstruction
    if (message.role === 'assistant') {
      const text = flattenText(message.content)
      const calls = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => {
          if (block.type !== 'tool-call') return undefined
          let args: unknown = {}
          try {
            args = block.arguments.length > 0 ? JSON.parse(block.arguments) : {}
          } catch {
            args = {}
          }
          return { functionCall: { name: block.name, args } }
        })
        .filter((entry) => entry !== undefined)
      const parts = [...(text.length > 0 ? [{ text }] : []), ...calls]
      if (parts.length > 0) wire.push({ role: 'model', parts })
      continue
    }
    // user-role message: text/images first, then function responses
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    const hasImages = message.content.some((block) => block.type === 'image')
    const parts: unknown[] = []
    if (hasImages) {
      parts.push(...userParts(message.content, images))
    } else {
      const text = flattenText(message.content)
      if (text.length > 0) parts.push({ text })
    }
    for (const result of toolResults) {
      parts.push({
        functionResponse: { name: callIdName(result.toolCallId), response: { result: resultValue(result) } },
      })
    }
    if (parts.length > 0) wire.push({ role: 'user', parts })
  }
  return wire
}

/** Build the full wire request. */
export function serializeRequest(
  options: GenerateOptions,
  images: ReadonlyMap<string, ImageBytes>,
  maxTokens: number,
): unknown {
  const tools: unknown[] | undefined = options.tools?.map((tool: ToolSchema) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
  return {
    ...(options.system !== undefined ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    contents: serializeMessages(options.messages, images),
    generationConfig: {
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      maxOutputTokens: options.maxTokens ?? maxTokens,
      ...(options.stop !== undefined && options.stop.length > 0 ? { stopSequences: options.stop } : {}),
    },
    ...(tools !== undefined && tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
  }
}
