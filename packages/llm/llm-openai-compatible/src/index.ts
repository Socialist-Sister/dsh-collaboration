/**
 * Register the OpenAI-compatible adapter for every shipped provider route
 * (`openai`, `moonshot`, `ollama`, `openrouter`, `siliconflow`, `groq`) on
 * `ctx.llm`. Connection facts resolve per request from the optional
 * `llm-openai` user-settings section, so a changed base URL, catalog, or
 * key reaches the very next request without restarting anything.
 * @module @dsh-collaboration/llm-openai-compatible
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  LlmError,
  RetryPolicySchema,
  assertUsableApiKey,
  resolveRetryPolicy,
  type ResolvedRetryPolicy,
  type RetryPolicyConfig,
} from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { OpenAiCompatibleAdapter } from './adapter.js'
import { PROVIDER_ROUTES } from './providers.js'
import type { ModelEntry, RouteConnection } from './types.js'

export { OpenAiCompatibleAdapter } from './adapter.js'
export { PROVIDER_ROUTES } from './providers.js'

export const name = 'llm-openai-compatible'
export const inject = ['llm']

const NS = settingsNamespace('llm-openai')

const DEFAULT_MAX_TOKENS = 16384
const DEFAULT_CONTEXT_WINDOW = 128000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  vision: z.boolean(),
})

const RouteProfile = z.object({
  enabled: z.boolean(),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
  models: z.array(catalogModel),
})

export interface OpenAiConfigSchema {
  openai?: RouteProfileOutput | null
  moonshot?: RouteProfileOutput | null
  ollama?: RouteProfileOutput | null
  openrouter?: RouteProfileOutput | null
  siliconflow?: RouteProfileOutput | null
  zhipu?: RouteProfileOutput | null
  groq?: RouteProfileOutput | null
  maxTokens?: number | null
  defaultContextWindow?: number | null
  streamIdleTimeoutMs?: number | null
  retryPolicy?: RetryPolicyConfig | null
}

interface RouteProfileOutput {
  enabled?: boolean | null
  apiKeyEnv?: string | null
  baseURL?: string | null
  models?: { id?: string | null; name?: string | null; description?: string | null; contextWindow?: number | null; maxTokens?: number | null; vision?: boolean | null }[] | null
}

export const Config: z<OpenAiConfigSchema> = z.object({
  openai: RouteProfile,
  moonshot: RouteProfile,
  ollama: RouteProfile,
  openrouter: RouteProfile,
  siliconflow: RouteProfile,
  zhipu: RouteProfile,
  groq: RouteProfile,
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

interface RawRouteProfile {
  enabled?: boolean
  apiKeyEnv?: string
  baseURL?: string
  models?: ModelEntry[]
}

interface RawConfig {
  [key: string]: unknown
  maxTokens?: number
  defaultContextWindow?: number
  streamIdleTimeoutMs?: number
  retryPolicy?: unknown
}

/** Validate one catalog and reject ids or capacities that cannot round-trip. */
function resolveModels(route: string, models: readonly ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>()
  return models.map((model) => {
    if (typeof model.id !== 'string' || model.id.length === 0) {
      throw new Error(`llm-openai: ${route} catalog model ids must be non-empty strings`)
    }
    if (seen.has(model.id)) throw new Error(`llm-openai: ${route} duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`llm-openai: ${route} model "${model.id}" contextWindow must be a positive integer`)
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(`llm-openai: ${route} model "${model.id}" maxTokens must be a positive integer`)
    }
    return model
  })
}

export interface ResolvedAdapterOptions {
  /** Connection facts for every shipped route, defaults merged. */
  connections: RouteConnection[]
  /** Route ids currently enabled (the registration's route set). */
  activeRoutes: string[]
  maxTokens: number
  defaultContextWindow: number
  streamIdleTimeoutMs: number
  retryPolicy: ResolvedRetryPolicy
}

/** Resolve raw plugin config or a settings snapshot into validated connection facts. */
export function resolveAdapterOptions(raw: RawConfig): ResolvedAdapterOptions {
  const maxTokens = raw.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('llm-openai: maxTokens must be a positive safe integer')
  }
  const defaultContextWindow = raw.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) {
    throw new Error('llm-openai: defaultContextWindow must be a positive integer')
  }
  const streamIdleTimeoutMs = raw.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-openai: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const connections: RouteConnection[] = []
  const activeRoutes: string[] = []
  for (const route of PROVIDER_ROUTES) {
    const profile = (raw[route.id] ?? {}) as RawRouteProfile
    if (profile.enabled === false) continue
    connections.push({
      provider: route.id,
      displayName: route.displayName,
      baseURL: (profile.baseURL ?? route.defaultBaseURL).replace(/\/+$/, ''),
      ...(profile.apiKeyEnv !== undefined ? { apiKeyEnv: profile.apiKeyEnv } : route.defaultApiKeyEnv !== undefined ? { apiKeyEnv: route.defaultApiKeyEnv } : {}),
      models: resolveModels(route.id, profile.models ?? route.defaultModels),
    })
    activeRoutes.push(route.id)
  }
  return {
    connections,
    activeRoutes,
    maxTokens,
    defaultContextWindow,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(raw.retryPolicy as any, 'llm-openai: retryPolicy'),
  }
}

export function apply(ctx: any, config: RawConfig) {
  let current: () => RawConfig = () => config
  let lastRaw: unknown
  let lastGood: ResolvedAdapterOptions

  const options = (): ResolvedAdapterOptions => {
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
      ctx.logger.error('llm-openai: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const connectionFor = (provider: string): RouteConnection => {
    const connection = options().connections.find((entry) => entry.provider === provider)
    if (connection === undefined) throw new LlmError(`unknown provider route "${provider}"`, 'NO_ADAPTER')
    return connection
  }

  const resolveApiKey = async (provider: string): Promise<string | undefined> => {
    const connection = connectionFor(provider)
    const ref = connection.apiKeyEnv
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-openai', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-openai', ref)
      }
    }
    throw new LlmError(
      `llm-openai: no API key for provider route "${provider}"; store ${ref} through the credentials service or export it in the launching environment`,
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

  const adapter = new OpenAiCompatibleAdapter({
    connectionFor,
    resolveApiKey,
    readImage,
    resolveUserId,
    fallbacks: () => {
      const current = options()
      return {
        maxTokens: current.maxTokens,
        defaultContextWindow: current.defaultContextWindow,
        streamIdleTimeoutMs: current.streamIdleTimeoutMs,
      }
    },
    retryPolicy: () => options().retryPolicy,
  })

  ctx.llm.registerConfigurableProviders(
    PROVIDER_ROUTES.map((route) => ({
      provider: route.id,
      displayName: route.displayName,
      settingsNs: NS,
      settingsPath: [route.id],
      declared: false,
    })),
  )
  const registration = ctx.llm.registerAdapter(options().activeRoutes, adapter)

  const ensureRegistrationFacts = () => {
    const currentOptions = options()
    const routesChanged =
      currentOptions.activeRoutes.length !== registrationRouteCount() ||
      currentOptions.activeRoutes.some((route, index) => route !== registrationRouteAt(index))
    const policyChanged = !deepEqualJson(currentOptions.retryPolicy, registeredPolicy)
    if (!routesChanged && !policyChanged) return
    registration.replace(currentOptions.activeRoutes)
    registeredPolicy = currentOptions.retryPolicy
    lastRouteSet = [...currentOptions.activeRoutes]
  }

  let registeredPolicy = options().retryPolicy
  let lastRouteSet: string[] = [...options().activeRoutes]
  const registrationRouteCount = () => lastRouteSet.length
  const registrationRouteAt = (index: number) => lastRouteSet[index]

  installSettingsSection(ctx, NS, Config, config as any, {
    setSource: (source: any) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })

  ctx.llm.registerModelDiscovery(NS, async (request: any) => {
    const base = (request.baseURL ?? '').replace(/\/+$/, '')
    if (base.length === 0) {
      throw new LlmError('llm-openai: a base URL is required to interrogate an endpoint', 'INVALID_REQUEST')
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (request.apiKey !== undefined && request.apiKey.length > 0) {
      headers.authorization = `Bearer ${request.apiKey}`
    }
    let response: Response
    try {
      response = await fetch(`${base}/models`, { headers, signal: request.signal })
    } catch (error) {
      throw new LlmError(`model list request to ${base} failed`, 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      throw new LlmError(`model list request failed (HTTP ${response.status})`, 'TRANSPORT')
    }
    const body: any = await response.json()
    const items: any[] = Array.isArray(body?.data) ? body.data : []
    const seen = new Set<string>()
    const models: { id: string; name?: string }[] = []
    for (const item of items) {
      const id = item?.id
      if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
      seen.add(id)
      models.push({ id })
    }
    return models
  })
}
