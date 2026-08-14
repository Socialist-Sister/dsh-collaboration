/**
 * Parse an SSE byte stream into data payloads. Yields `[DONE]` as the final
 * value and returns; throws when the stream ends without it.
 * @module @dsh-collaboration/llm-openai-compatible/sse
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { EventSourceParserStream } from 'eventsource-parser/stream'

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())
  for await (const event of events) {
    if (typeof event.data !== 'string') continue
    yield event.data
    if (event.data === '[DONE]') return
  }
  throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}
