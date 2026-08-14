/**
 * Translate Anthropic Messages SSE events into harness StreamChunks.
 * Text blocks map to text, `thinking` blocks to reasoning, `tool_use`
 * blocks to tool calls (input JSON accumulated from `input_json_delta`
 * fragments or the block's initial `input`). Usage and finish are emitted
 * after `message_stop`.
 * @module @dsh-collaboration/llm-anthropic/translate
 */
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmError,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'

interface BlockState {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: string
  name?: string
  hasDelta: boolean
  initialInput?: unknown
}

function mapStopReason(reason: string): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return { kind: 'stop' }
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    case 'refusal':
      return { kind: 'error', failure: { message: 'model refused the request', code: 'REFUSAL' } }
    default:
      return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
  }
}

function closeBlock(block: BlockState) {
  if (block.kind === 'text') return { type: 'text' as const, text: block.text }
  if (block.kind === 'reasoning') return { type: 'reasoning' as const, text: block.text }
  const argumentsText =
    block.hasDelta || block.initialInput === undefined ? block.text : JSON.stringify(block.initialInput)
  return {
    type: 'tool-call' as const,
    id: CallId(block.callId ?? ''),
    name: block.name ?? '',
    arguments: argumentsText,
  }
}

/**
 * Consume SSE data payloads (Anthropic event JSON) and yield StreamChunks.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  const blocks = new Map<number, BlockState>()
  const order: BlockState[] = []
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let pendingFinish: FinishReason | undefined
  let sawMessageStop = false

  for await (const payload of payloads) {
    let event: any
    try {
      event = JSON.parse(payload)
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    switch (event.type) {
      case 'message_start': {
        const usage = event.message?.usage ?? {}
        inputTokens = usage.input_tokens ?? 0
        cacheReadTokens = usage.cache_read_input_tokens ?? 0
        cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
        break
      }
      case 'content_block_start': {
        const index: number = event.index
        const block = event.content_block ?? {}
        let state: BlockState
        if (block.type === 'thinking') {
          state = { index, kind: 'reasoning', text: '', hasDelta: false }
          yield { type: 'block-start', index, blockType: 'reasoning' }
        } else if (block.type === 'tool_use') {
          state = {
            index,
            kind: 'tool-call',
            text: '',
            callId: typeof block.id === 'string' ? block.id : undefined,
            name: typeof block.name === 'string' ? block.name : undefined,
            hasDelta: false,
            initialInput: block.input,
          }
          yield { type: 'block-start', index, blockType: 'tool-call' }
        } else {
          state = { index, kind: 'text', text: '', hasDelta: false }
          yield { type: 'block-start', index, blockType: 'text' }
        }
        blocks.set(index, state)
        order.push(state)
        break
      }
      case 'content_block_delta': {
        const state = blocks.get(event.index)
        if (state === undefined) break
        const delta = event.delta ?? {}
        if (typeof delta.text === 'string' && delta.text.length > 0) {
          state.text += delta.text
          yield { type: 'text-delta', index: state.index, text: delta.text }
        } else if (typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          state.text += delta.thinking
          yield { type: 'reasoning-delta', index: state.index, text: delta.thinking }
        } else if (typeof delta.partial_json === 'string') {
          state.hasDelta = true
          state.text += delta.partial_json
          yield {
            type: 'tool-call-delta',
            index: state.index,
            id: CallId(state.callId ?? ''),
            ...(state.name !== undefined ? { name: state.name } : {}),
            argumentsDelta: delta.partial_json,
          }
        }
        break
      }
      case 'content_block_stop': {
        const state = blocks.get(event.index)
        if (state === undefined) break
        yield { type: 'block-end', index: state.index, block: closeBlock(state) }
        break
      }
      case 'message_delta': {
        const delta = event.delta ?? {}
        if (typeof delta.stop_reason === 'string') pendingFinish = mapStopReason(delta.stop_reason)
        const usage = event.usage ?? {}
        outputTokens = usage.output_tokens ?? outputTokens
        break
      }
      case 'message_stop': {
        sawMessageStop = true
        break
      }
      default:
        break // ping etc.
    }
  }
  if (!sawMessageStop) throw new LlmError('SSE stream ended without message_stop', 'STREAM_CLOSED')

  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  }
  yield { type: 'usage', usage }
  const reason = pendingFinish ?? { kind: 'stop' as const }
  yield {
    type: 'finish',
    reason:
      reason.kind === 'stop' && order.length === 0
        ? { kind: 'error', failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE } }
        : reason,
  }
}
