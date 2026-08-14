/**
 * Register the Gemini adapter for the `gemini` provider route on
 * `ctx.llm`. Connection facts resolve per request from the optional
 * `llm-gemini` user-settings section.
 * @module @dsh-collaboration/llm-gemini
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, RetryPolicySchema, assertUsableApiKey, resolveRetryPolicy, type ResolvedRetryPolicy, type RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { GeminiAdapter } from './adapter.js'

export { GeminiAdapter } from './adapter.js'

export const name = 'llm-gemini'
export const inject = ['llm']

const NS = settingsNamespace('llm-gemini')
const PROVIDER = 'gemini'
const DEFAULT_API_KEY_ENV = 'GEMINI_API_KEY'
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_CONTEXT_WINDOW = 1000000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

const DEFAULT_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxTokens: 65536, vision: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxTokens: 65536, vision: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000, maxTokens: 8192, vision: true },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite', contextWindow: 1000000, maxTokens: 8192, vision: true },
]

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  vision: z.boolean(),
})

export interface GeminiConfigSchema {
  enabled?: boolean | null
  apiKeyEnv?: string | null
  baseURL?: string | null
  models?: { id?: string | null; name?: string | null; description?: string | null; contextWindow?: number | null; maxTokens?: number | null; vision?: boolean | null }[] | null
  maxTokens?: number | null
  defaultContextWindow?: number | null
  streamIdleTimeoutMs?: number | null
  retryPolicy?: RetryPolicyConfig | null
}

export const Config: z<GeminiConfigSchema> = z.object({
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
      throw new Error('llm-gemini: catalog model ids must be non-empty strings')
    }
    if (seen.has(model.id)) throw new Error(`llm-gemini: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`llm-gemini: model "${model.id}" contextWindow must be a positive integer`)
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(`llm-gemini: model "${model.id}" maxTokens must be a positive integer`)
    }
    return model
  })
}

export function resolveAdapterOptions(raw: RawConfig): ResolvedConnection {
  const maxTokens = raw.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('llm-gemini: maxTokens must be a positive safe integer')
  }
  const defaultContextWindow = raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) {
    throw new Error('llm-gemini: defaultContextWindow must be a positive integer')
  }
  const streamIdleTimeoutMs = raw.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-gemini: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    provider: PROVIDER,
    displayName: 'Google Gemini',
    baseURL: (raw.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKeyEnv: raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    models: resolveModels(raw.models ?? DEFAULT_MODELS),
    maxTokens,
    defaultContextWindow,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(raw.retryPolicy as any, 'llm-gemini: retryPolicy'),
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
      ctx.logger.error('llm-gemini: keeping the last good configuration after an invalid settings section')
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
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-gemini', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-gemini', ref)
      }
    }
    throw new LlmError(
      `llm-gemini: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials service or export it in the launching environment`,
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

  const adapter = new GeminiAdapter({
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
    { provider: PROVIDER, displayName: 'Google Gemini', settingsNs: NS, settingsPath: [] },
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
