/**
 * Parse a Gemini SSE byte stream into data payloads. Unlike chat-completions
 * streams, Gemini sends no `[DONE]` sentinel — the stream simply ends.
 * @module @dsh-openagent/llm-gemini/sse
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
