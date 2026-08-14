/**
 * Parse an SSE byte stream into data payloads (Anthropic event JSON).
 * @module @dsh-openagent/llm-anthropic/sse
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { EventSourceParserStream } from 'eventsource-parser/stream'

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())
  let sawAny = false
  for await (const event of events) {
    if (typeof event.data !== 'string' || event.data.length === 0) continue
    sawAny = true
    yield event.data
  }
  if (!sawAny) throw new LlmError('SSE stream ended without events', 'STREAM_CLOSED')
}
