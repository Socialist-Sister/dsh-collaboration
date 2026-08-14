/**
 * Register the Anthropic Messages adapter for the `anthropic` provider
 * route on `ctx.llm`. Connection facts resolve per request from the
 * optional `llm-anthropic` user-settings section.
 * @module @dsh-openagent/llm-anthropic
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, RetryPolicySchema, assertUsableApiKey, resolveRetryPolicy, type ResolvedRetryPolicy, type RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { AnthropicAdapter } from './adapter.js'

export { AnthropicAdapter } from './adapter.js'

export const name = 'llm-anthropic'
export const inject = ['llm']

const NS = settingsNamespace('llm-anthropic')
const PROVIDER = 'anthropic'
const DEFAULT_API_KEY_ENV = 'ANTHROPIC_API_KEY'
const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_CONTEXT_WINDOW = 200000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

const DEFAULT_MODELS = [
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 64000, vision: true },
  { id: 'claude-opus-4', name: 'Claude Opus 4', contextWindow: 200000, maxTokens: 32000, vision: true },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 64000, vision: true },
  { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', contextWindow: 200000, maxTokens: 64000, vision: true },
  { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', contextWindow: 200000, maxTokens: 8192, vision: true },
]

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  vision: z.boolean(),
})

export interface AnthropicConfigSchema {
  enabled?: boolean | null
  apiKeyEnv?: string | null
  baseURL?: string | null
  models?: { id?: string | null; name?: string | null; description?: string | null; contextWindow?: number | null; maxTokens?: number | null; vision?: boolean | null }[] | null
  maxTokens?: number | null
  defaultContextWindow?: number | null
  streamIdleTimeoutMs?: number | null
  retryPolicy?: RetryPolicyConfig | null
}

export const Config: z<AnthropicConfigSchema> = z.object({
  enabled: z.boolean(),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
  models: z.array(catalogModel),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

interface RawModel {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  vision?: boolean
}

interface RawConfig {
  [key: string]: unknown
  enabled?: boolean
  apiKeyEnv?: string
  baseURL?: string
  models?: RawModel[]
  maxTokens?: number
  defaultContextWindow?: number
  streamIdleTimeoutMs?: number
  retryPolicy?: unknown
}

export interface ResolvedConnection {
  provider: string
  displayName: string
  baseURL: string
  apiKeyEnv: string
  models: readonly RawModel[]
  maxTokens: number
  defaultContextWindow: number
  streamIdleTimeoutMs: number
  retryPolicy: ResolvedRetryPolicy
}

function resolveModels(models: readonly RawModel[]): RawModel[] {
  const seen = new Set<string>()
  return models.map((model) => {
    if (typeof model.id !== 'string' || model.id.length === 0) {
      throw new Error('llm-anthropic: catalog model ids must be non-empty strings')
    }
    if (seen.has(model.id)) throw new Error(`llm-anthropic: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`llm-anthropic: model "${model.id}" contextWindow must be a positive integer`)
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(`llm-anthropic: model "${model.id}" maxTokens must be a positive integer`)
    }
    return model
  })
}

export function resolveAdapterOptions(raw: RawConfig): ResolvedConnection {
  const maxTokens = raw.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('llm-anthropic: maxTokens must be a positive safe integer')
  }
  const defaultContextWindow = raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) {
    throw new Error('llm-anthropic: defaultContextWindow must be a positive integer')
  }
  const streamIdleTimeoutMs = raw.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-anthropic: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    provider: PROVIDER,
    displayName: 'Anthropic',
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKeyEnv: raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    models: resolveModels(raw.models ?? DEFAULT_MODELS),
    maxTokens,
    defaultContextWindow,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(raw.retryPolicy as any, 'llm-anthropic: retryPolicy'),
  }
}

export function apply(ctx: any, config: RawConfig) {
  let current: () => RawConfig = () => config
  let lastRaw: unknown
  let lastGood: ResolvedConnection | undefined

  const options = (): ResolvedConnection => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-anthropic: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (): Promise<string> => {
    const connection = options()
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-anthropic', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-anthropic', ref)
      }
    }
    throw new LlmError(
      `llm-anthropic: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials service or export it in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  const attachments = ctx.get('attachments')
  const readImage = async (ref: any, signal?: AbortSignal): Promise<Uint8Array | undefined> => {
    if (attachments === undefined) return undefined
    const stored = await attachments.readImage(ref, signal)
    return stored.data
  }

  let userId: string | undefined
  const resolveUserId = () => (userId ??= getOrCreateAnonymousUserId())

  const adapter = new AnthropicAdapter({
    connection: () => options(),
    resolveApiKey,
    readImage,
    resolveUserId,
    fallbacks: () => {
      const currentOptions = options()
      return {
        maxTokens: currentOptions.maxTokens,
        defaultContextWindow: currentOptions.defaultContextWindow,
        streamIdleTimeoutMs: currentOptions.streamIdleTimeoutMs,
      }
    },
    retryPolicy: () => options().retryPolicy,
  })

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Anthropic', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)

  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }
  let registeredPolicy = options().retryPolicy

  installSettingsSection(ctx, NS, Config, config as any, {
    setSource: (source: any) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
