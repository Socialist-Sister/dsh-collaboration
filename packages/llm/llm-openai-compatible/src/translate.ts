/**
 * Translate OpenAI chat-completions SSE payloads into the harness
 * `StreamChunk` protocol. One stateful harness block per content or tool
 * call index; finish reason and the latest usage are deferred to `[DONE]`.
 * @module @dsh-collaboration/llm-openai-compatible/translate
 */
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmError,
  type ContentBlock,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'

interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface WireToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** Map the wire finish_reason vocabulary to the harness FinishReason. */
function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return { kind: 'stop' }
    case 'tool_calls':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
  }
}

/** Map wire usage fields to disjoint harness counts (cached input subtracted). */
function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: (usage.prompt_tokens ?? 0) - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens ?? 0,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  }
}

interface TextBlock {
  index: number
  kind: 'text'
  text: string
}

interface ToolBlock {
  index: number
  kind: 'tool-call'
  callId?: string
  name?: string
  text: string
}

function closeBlock(block: TextBlock | ToolBlock): ContentBlock {
  if (block.kind === 'text') {
    return { type: 'text', text: block.text }
  }
  return {
    type: 'tool-call',
    id: CallId(block.callId ?? ''),
    name: block.name ?? '',
    arguments: block.text,
  }
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * A `stop` finish with no opened blocks maps to an `EMPTY_RESPONSE` error
 * finish instead of a successful empty message.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: TextBlock | undefined
  const toolBlocks = new Map<number, ToolBlock>()
  const order: (TextBlock | ToolBlock)[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  const open = (kind: 'text' | 'tool-call'): TextBlock | ToolBlock => {
    const block: TextBlock | ToolBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason:
          reason.kind === 'stop' && order.length === 0
            ? { kind: 'error', failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE } }
            : reason,
      }
      return
    }
    let chunk: any
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}
      const content: unknown = delta.content
      if (typeof content === 'string' && content.length > 0) {
        if (textBlock === undefined) {
          textBlock = open('text') as TextBlock
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }
      for (const call of (delta.tool_calls ?? []) as WireToolCall[]) {
        const index = call.index ?? 0
        let block = toolBlocks.get(index)
        if (block === undefined) {
          block = open('tool-call') as ToolBlock
          toolBlocks.set(index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call.id !== undefined) block.callId = call.id
        if (call.function?.name !== undefined) block.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...(block.name !== undefined ? { name: block.name } : {}),
          argumentsDelta: fragment,
        }
      }
      if (typeof choice.finish_reason === 'string') pendingFinish = mapFinishReason(choice.finish_reason)
    }
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage as WireUsage)
  }
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}
