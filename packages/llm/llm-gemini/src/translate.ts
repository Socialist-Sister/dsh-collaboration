/**
 * Translate Gemini `streamGenerateContent` SSE payloads into harness
 * StreamChunks. Text parts open text blocks; `functionCall` parts arrive
 * atomically and open tool-call blocks with synthetic ids (`<name>#<n>`);
 * usage and finish are emitted after the stream ends.
 * @module @dsh-collaboration/llm-gemini/translate
 */
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmError,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'STOP':
      return { kind: 'stop' }
    case 'MAX_TOKENS':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
  }
}

/**
 * Consume Gemini SSE data payloads and yield StreamChunks. A `STOP` finish
 * with no content maps to an `EMPTY_RESPONSE` error finish.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let callCounter = 0
  let pendingFinish: FinishReason | undefined
  let usage: TokenUsage | undefined
  let producedContent = false

  for await (const payload of payloads) {
    let chunk: any
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    const candidates: any[] = Array.isArray(chunk.candidates) ? chunk.candidates : []
    if (candidates.length === 0) {
      const blockReason = chunk.promptFeedback?.blockReason
      if (typeof blockReason === 'string' && blockReason.length > 0) {
        pendingFinish = {
          kind: 'error',
          failure: { message: `request blocked: ${blockReason}`, code: 'BLOCKED' },
        }
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate.finishReason === 'string') pendingFinish = mapFinishReason(candidate.finishReason)
      const parts: any[] = candidate.content?.parts ?? []
      for (const part of parts) {
        if (typeof part.text === 'string') {
          producedContent = true
          yield { type: 'block-start', index: nextIndex, blockType: 'text' }
          yield { type: 'text-delta', index: nextIndex, text: part.text }
          yield { type: 'block-end', index: nextIndex, block: { type: 'text', text: part.text } }
          nextIndex++
        } else if (part.functionCall !== undefined) {
          producedContent = true
          const name = typeof part.functionCall.name === 'string' ? part.functionCall.name : 'call'
          const id = `${name}#${++callCounter}`
          const argumentsText = JSON.stringify(part.functionCall.args ?? {})
          yield { type: 'block-start', index: nextIndex, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: nextIndex, id: CallId(id), name, argumentsDelta: argumentsText }
          yield {
            type: 'block-end',
            index: nextIndex,
            block: { type: 'tool-call', id: CallId(id), name, arguments: argumentsText },
          }
          nextIndex++
        }
      }
    }
    const usageMetadata = chunk.usageMetadata
    if (usageMetadata !== undefined) {
      usage = {
        inputTokens: usageMetadata.promptTokenCount ?? 0,
        outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        ...(usageMetadata.cachedContentTokenCount ? { cacheReadTokens: usageMetadata.cachedContentTokenCount } : {}),
        ...(usageMetadata.thoughtsTokenCount ? { reasoningTokens: usageMetadata.thoughtsTokenCount } : {}),
      }
    }
  }

  if (usage !== undefined) yield { type: 'usage', usage }
  const reason = pendingFinish ?? { kind: 'stop' as const }
  yield {
    type: 'finish',
    reason:
      reason.kind === 'stop' && !producedContent
        ? { kind: 'error', failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE } }
        : reason,
  }
}
