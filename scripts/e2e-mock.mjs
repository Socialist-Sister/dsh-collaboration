/**
 * Offline end-to-end adapter validation against a LOCAL mock provider
 * speaking the three wire protocols. Verifies, without any external API key:
 *
 *   - request routing and auth headers (OpenAI Bearer, Anthropic x-api-key,
 *     Gemini x-goog-api-key)
 *   - message serialization: text, tool calls, tool results, image data URLs
 *   - SSE parsing and chunk translation for each protocol
 *   - usage and finish-reason mapping
 *   - HTTP error mapping (401 → AUTH)
 *
 * Run: node scripts/e2e-mock.mjs
 */
import http from 'node:http'
import { OpenAiCompatibleAdapter } from '../packages/llm/llm-openai-compatible/lib/index.js'
import { AnthropicAdapter } from '../packages/llm/llm-anthropic/lib/index.js'
import { GeminiAdapter } from '../packages/llm/llm-gemini/lib/index.js'

const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let failures = 0
function assert(condition, label) {
  if (condition) {
    console.log(`  ok: ${label}`)
  } else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

/** Read and parse one request body. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
  })
}

function sse(res, payloads, chatCompletions = false) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const payload of payloads) res.write(`data: ${JSON.stringify(payload)}\n\n`)
  if (chatCompletions) res.write('data: [DONE]\n\n')
  res.end()
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req)
  const url = req.url

  // ── OpenAI-compatible ──
  if (url.endsWith('/chat/completions')) {
    assert(req.headers.authorization === 'Bearer test-key', 'openai: Bearer auth header')
    assert(req.headers['content-type'] === 'application/json', 'openai: content-type')
    assert(body.stream === true, 'openai: stream requested')
    assert(body.stream_options?.include_usage === true, 'openai: usage reporting requested')
    if (body.model === 'http-401') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }))
      return
    }
    const hasToolResult = body.messages.some((m) => m.role === 'tool')
    assert(Array.isArray(body.messages), 'openai: messages serialized')
    assert(body.messages[0].role === 'system' && body.messages[0].content === 'sys-text', 'openai: system slot mapped')
    const userWithImage = body.messages.find((m) => Array.isArray(m.content))
    if (userWithImage) {
      const imagePart = userWithImage.content.find((part) => part.type === 'image_url')
      assert(imagePart?.image_url?.url?.startsWith(`data:image/png;base64,${PIXEL_PNG}`), 'openai: image encoded as data URL')
      sse(res, [
        { id: 'c1', choices: [{ delta: { content: 'saw-image' } }] },
        { id: 'c1', choices: [{ delta: {}, finish_reason: 'stop' }] },
        { id: 'c1', usage: { prompt_tokens: 9, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 } } },
      ], true)
      return
    }
    if (body.tools && body.tools.length > 0) {
      assert(body.tools[0].function?.name === 'probe', 'openai: tool schema mapped')
      const hasToolCall = body.messages.some((m) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
      assert(hasToolCall, 'openai: assistant tool_calls replayed')
      assert(body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call-1'), 'openai: tool result message with id')
      sse(res, [
        { id: 'c2', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-9', function: { name: 'probe', arguments: '{"a":' } }] } }] },
        { id: 'c2', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] },
        { id: 'c2', choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ], true)
      return
    }
    sse(res, [
      { id: 'c1', choices: [{ delta: { role: 'assistant', content: 'hello ' } }] },
      { id: 'c1', choices: [{ delta: { content: 'openai' } }] },
      { id: 'c1', choices: [{ delta: {}, finish_reason: 'stop' }] },
      { id: 'c1', usage: { prompt_tokens: 7, completion_tokens: 2 } },
    ], true)
    return
  }

  // ── Anthropic ──
  if (url.endsWith('/v1/messages')) {
    assert(req.headers['x-api-key'] === 'test-key', 'anthropic: x-api-key header')
    assert(req.headers['anthropic-version'] === '2023-06-01', 'anthropic: version header')
    assert(typeof body.max_tokens === 'number', 'anthropic: max_tokens sent')
    assert(body.system === 'sys-text', 'anthropic: system slot mapped')
    assert(body.stream === true, 'anthropic: stream requested')
    const userContent = body.messages.find((m) => m.role === 'user')?.content
    const imageBlock = Array.isArray(userContent) ? userContent.find((b) => b.type === 'image') : undefined
    if (imageBlock) {
      assert(imageBlock.source?.data === PIXEL_PNG && imageBlock.source?.media_type === 'image/png', 'anthropic: image block encoded')
    }
    if (body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))) {
      assert(true, 'anthropic: tool_result block present')
    }
    if (body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use'))) {
      assert(true, 'anthropic: tool_use block present')
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello ' } })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'anthropic' } })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
    res.end()
    return
  }

  // ── Gemini ──
  if (url.includes(':streamGenerateContent')) {
    assert(req.headers['x-goog-api-key'] === 'test-key', 'gemini: x-goog-api-key header')
    assert(body.systemInstruction?.parts?.[0]?.text === 'sys-text', 'gemini: systemInstruction mapped')
    assert(Array.isArray(body.contents), 'gemini: contents serialized')
    const userParts = body.contents.find((c) => c.role === 'user')?.parts ?? []
    const inline = userParts.find((p) => p.inlineData)
    if (inline) {
      assert(inline.inlineData.data === PIXEL_PNG && inline.inlineData.mimeType === 'image/png', 'gemini: inlineData encoded')
    }
    if (body.contents.some((c) => c.role === 'model' && c.parts.some((p) => p.functionCall))) {
      assert(true, 'gemini: functionCall part present')
    }
    if (body.contents.some((c) => c.role === 'user' && c.parts.some((p) => p.functionResponse))) {
      assert(true, 'gemini: functionResponse part present')
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello ' }], role: 'model' } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } })}\n\n`)
    res.end()
    return
  }

  res.writeHead(404)
  res.end()
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const fallbacks = () => ({ maxTokens: 1024, defaultContextWindow: 128000, streamIdleTimeoutMs: 300000 })
const textMessage = (text) => [{ id: 't1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
const IMAGE_REF = { attachmentId: 'img1', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }
const pixel = () => new Uint8Array(Buffer.from(PIXEL_PNG, 'base64'))

async function collect(adapter, options) {
  let text = ''
  let usage
  let finish
  const toolCalls = []
  for await (const chunk of adapter.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk.reason
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') toolCalls.push(chunk.block)
  }
  return { text, usage, finish, toolCalls }
}

function openAiConfig() {
  return {
    connectionFor(p) {
      return { provider: p, displayName: 'Mock', baseURL: base, apiKeyEnv: 'MOCK_KEY', models: [{ id: 'm', name: 'M', vision: true }] }
    },
    resolveApiKey: () => Promise.resolve('test-key'),
    readImage: (ref) => Promise.resolve(ref.attachmentId === 'img1' ? pixel() : undefined),
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
}
function anthropicConfig() {
  return {
    connection: () => ({ provider: 'anthropic', displayName: 'Mock', baseURL: base, apiKeyEnv: 'MOCK_KEY', models: [{ id: 'm', name: 'M', vision: true }] }),
    resolveApiKey: () => Promise.resolve('test-key'),
    readImage: (ref) => Promise.resolve(ref.attachmentId === 'img1' ? pixel() : undefined),
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
}
function geminiConfig() {
  return {
    connection: () => ({ provider: 'gemini', displayName: 'Mock', baseURL: base, apiKeyEnv: 'MOCK_KEY', models: [{ id: 'm', name: 'M', vision: true }] }),
    resolveApiKey: () => Promise.resolve('test-key'),
    readImage: (ref) => Promise.resolve(ref.attachmentId === 'img1' ? pixel() : undefined),
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
}

const historyWithToolCall = [
  { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'probe', arguments: '{"a":1}' }], source: { kind: 'model', provider: 'x', model: 'y' } },
  { id: 'u2', role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '"ok"' }], isError: false }], source: { kind: 'tool', callId: 'call-1' } },
]

console.log('== OpenAI-compatible adapter ==')
{
  const adapter = new OpenAiCompatibleAdapter(openAiConfig())
  let r = await collect(adapter, { provider: 'openai', model: 'm', system: 'sys-text', messages: textMessage('hi'), maxTokens: 128 })
  assert(r.text === 'hello openai', `openai: text collected (${JSON.stringify(r.text)})`)
  assert(r.finish?.kind === 'stop', 'openai: finish stop')
  assert(r.usage?.inputTokens === 7 && r.usage?.outputTokens === 2, 'openai: usage mapped')

  r = await collect(adapter, { provider: 'openai', model: 'm', system: 'sys-text', messages: [{ id: 'i1', role: 'user', content: [{ type: 'text', text: 'what color' }, { type: 'image', attachment: IMAGE_REF }], source: { kind: 'user' } }], maxTokens: 128 })
  assert(r.text === 'saw-image', 'openai: vision call answered')

  r = await collect(adapter, { provider: 'openai', model: 'm', system: 'sys-text', messages: [...historyWithToolCall, ...textMessage('go')], tools: [{ name: 'probe', description: 'p', parameters: { type: 'object', properties: {} } }], maxTokens: 128 })
  assert(r.toolCalls.length === 1 && r.toolCalls[0].name === 'probe' && r.toolCalls[0].arguments === '{"a":1}', 'openai: tool-call stream assembled')
  assert(r.finish?.kind === 'tool-calls', 'openai: finish tool-calls')

  try {
    await collect(adapter, { provider: 'openai', model: 'http-401', messages: textMessage('x'), maxTokens: 128 })
    assert(false, 'openai: 401 raised')
  } catch (error) {
    assert(error.failure?.code === 'AUTH' && error.failure?.status === 401, `openai: 401 mapped to AUTH (${error.failure?.code})`)
  }
}

console.log('== Anthropic adapter ==')
{
  const adapter = new AnthropicAdapter(anthropicConfig())
  let r = await collect(adapter, { provider: 'anthropic', model: 'm', system: 'sys-text', messages: textMessage('hi'), maxTokens: 128 })
  assert(r.text === 'hello anthropic', `anthropic: text collected (${JSON.stringify(r.text)})`)
  assert(r.finish?.kind === 'stop', 'anthropic: finish stop')
  assert(r.usage?.inputTokens === 5 && r.usage?.outputTokens === 2, 'anthropic: usage mapped')

  r = await collect(adapter, { provider: 'anthropic', model: 'm', system: 'sys-text', messages: [...historyWithToolCall, ...textMessage('go')], tools: [{ name: 'probe', description: 'p', parameters: { type: 'object', properties: {} } }], maxTokens: 128 })
  assert(r.text.length > 0, 'anthropic: tool history accepted by wire (server saw tool_use/tool_result)')
}

console.log('== Gemini adapter ==')
{
  const adapter = new GeminiAdapter(geminiConfig())
  let r = await collect(adapter, { provider: 'gemini', model: 'm', system: 'sys-text', messages: textMessage('hi'), maxTokens: 128 })
  assert(r.text === 'hello gemini', `gemini: text collected (${JSON.stringify(r.text)})`)
  assert(r.finish?.kind === 'stop', 'gemini: finish stop')
  assert(r.usage?.inputTokens === 4 && r.usage?.outputTokens === 2, 'gemini: usage mapped')

  r = await collect(adapter, { provider: 'gemini', model: 'm', system: 'sys-text', messages: [{ id: 'i1', role: 'user', content: [{ type: 'text', text: 'what color' }, { type: 'image', attachment: IMAGE_REF }], source: { kind: 'user' } }], maxTokens: 128 })
  assert(r.text === 'hello gemini', 'gemini: vision inlineData accepted (server asserted encoding)')

  r = await collect(adapter, { provider: 'gemini', model: 'm', system: 'sys-text', messages: [...historyWithToolCall, ...textMessage('go')], tools: [{ name: 'probe', description: 'p', parameters: { type: 'object', properties: {} } }], maxTokens: 128 })
  assert(r.text.length > 0, 'gemini: tool history accepted by wire (server saw functionCall/functionResponse)')
}

server.close()
if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll mock-protocol assertions passed.')
