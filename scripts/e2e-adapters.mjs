/**
 * Standalone end-to-end adapter test: streams one real model call per
 * provider through the BUILT adapters, plus one vision call, without a
 * running DSH. Set the API keys you have as environment variables first:
 *
 *   $env:OPENAI_API_KEY = 'sk-...'
 *   $env:ANTHROPIC_API_KEY = 'sk-ant-...'
 *   $env:GEMINI_API_KEY = 'AIza...'
 *   node scripts/e2e-adapters.mjs
 *
 * Every configured provider must succeed; the script exits non-zero on the
 * first failure.
 */
import { OpenAiCompatibleAdapter } from '../packages/llm/llm-openai-compatible/lib/index.js'
import { AnthropicAdapter } from '../packages/llm/llm-anthropic/lib/index.js'
import { GeminiAdapter } from '../packages/llm/llm-gemini/lib/index.js'

const QUESTION = 'Reply with exactly one sentence: the capital of France is Paris.'

function messages(text) {
  return [{ id: 'e2e-1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
}

async function run(name, adapter, options) {
  process.stdout.write(`\n=== ${name} (${options.provider}/${options.model}) ===\n`)
  let text = ''
  let usage = null
  let finish = null
  for await (const chunk of adapter.stream(options)) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
      process.stdout.write(chunk.text)
    } else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  process.stdout.write(`\n[finish=${JSON.stringify(finish)} usage=${JSON.stringify(usage)}]\n`)
  if (finish?.kind !== 'stop' && finish?.kind !== 'max-tokens') throw new Error(`${name} finished with ${JSON.stringify(finish)}`)
  if (text.trim().length === 0) throw new Error(`${name} returned no text`)
  return text
}

const fallbacks = () => ({ maxTokens: 1024, defaultContextWindow: 128000, streamIdleTimeoutMs: 300000 })

function openAiConfig(envKey, baseURL, displayName, provider) {
  return {
    connectionFor(p) {
      return {
        provider: p, displayName, baseURL, apiKeyEnv: envKey,
        models: [{ id: 'any', name: 'Any', vision: true, contextWindow: 128000, maxTokens: 1024 }],
      }
    },
    resolveApiKey() {
      const key = process.env[envKey]
      if (!key) throw new Error(`missing env ${envKey}`)
      return Promise.resolve(key)
    },
    readImage(ref) {
      if (ref.attachmentId !== 'e2e-img') return Promise.resolve(undefined)
      const data = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      )
      return Promise.resolve(new Uint8Array(data))
    },
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
}

const IMAGE_REF = {
  attachmentId: 'e2e-img', mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'pixel.png',
}

const failures = []
const plans = []

if (process.env.OPENAI_API_KEY) {
  plans.push(['OpenAI text', new OpenAiCompatibleAdapter(openAiConfig('OPENAI_API_KEY', 'https://api.openai.com/v1', 'OpenAI', 'openai')), { provider: 'openai', model: 'gpt-4o-mini', messages: messages(QUESTION), maxTokens: 256 }])
  plans.push(['OpenAI vision', new OpenAiCompatibleAdapter(openAiConfig('OPENAI_API_KEY', 'https://api.openai.com/v1', 'OpenAI', 'openai')), { provider: 'openai', model: 'gpt-4o-mini', messages: [{ id: 'e2e-2', role: 'user', content: [{ type: 'text', text: 'What color is the image?' }, { type: 'image', attachment: IMAGE_REF }], source: { kind: 'user' } }], maxTokens: 256 }])
}
if (process.env.ANTHROPIC_API_KEY) {
  const config = {
    connection: () => ({ provider: 'anthropic', displayName: 'Anthropic', baseURL: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: [{ id: 'claude-haiku-4.5', name: 'Haiku', vision: true }] }),
    resolveApiKey: () => Promise.resolve(process.env.ANTHROPIC_API_KEY),
    readImage(ref) {
      if (ref.attachmentId !== 'e2e-img') return Promise.resolve(undefined)
      return Promise.resolve(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')))
    },
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
  plans.push(['Anthropic text', new AnthropicAdapter(config), { provider: 'anthropic', model: 'claude-haiku-4.5', messages: messages(QUESTION), maxTokens: 256 }])
}
if (process.env.GEMINI_API_KEY) {
  const config = {
    connection: () => ({ provider: 'gemini', displayName: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com', apiKeyEnv: 'GEMINI_API_KEY', models: [{ id: 'gemini-2.0-flash', name: 'Flash', vision: true }] }),
    resolveApiKey: () => Promise.resolve(process.env.GEMINI_API_KEY),
    readImage(ref) {
      if (ref.attachmentId !== 'e2e-img') return Promise.resolve(undefined)
      return Promise.resolve(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')))
    },
    resolveUserId: () => 'e2e',
    fallbacks,
    retryPolicy: () => undefined,
  }
  plans.push(['Gemini text', new GeminiAdapter(config), { provider: 'gemini', model: 'gemini-2.0-flash', messages: messages(QUESTION), maxTokens: 256 }])
  plans.push(['Gemini vision', new GeminiAdapter(config), { provider: 'gemini', model: 'gemini-2.0-flash', messages: [{ id: 'e2e-2', role: 'user', content: [{ type: 'text', text: 'What color is the image?' }, { type: 'image', attachment: IMAGE_REF }], source: { kind: 'user' } }], maxTokens: 256 }])
}

if (plans.length === 0) {
  console.error('No API keys configured: export OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY')
  process.exit(2)
}

for (const [name, adapter, options] of plans) {
  try {
    await run(name, adapter, options)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.error(`\nFAILED ${name}: ${error.message}`)
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} plan(s) failed:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`\nAll ${plans.length} plan(s) passed.`)
