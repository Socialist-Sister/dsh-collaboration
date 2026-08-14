/**
 * `OpenAiCompatibleAdapter`: fetch + SSE against any OpenAI-protocol
 * chat-completions endpoint, emitting harness StreamChunks. One instance
 * serves every registered provider route; connection facts and the bearer
 * token resolve per request through thunks owned by the registering plugin.
 * @module @dsh-openagent/llm-openai-compatible/adapter
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  attributionHeaders,
  isContextWindowExceededError,
  isQuotaExceededError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ImageBytes } from './serialize.js'
import { serializeRequest } from './serialize.js'
import { parseSse } from './sse.js'
import { translate } from './translate.js'
import type { RouteConnection } from './types.js'

const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): string | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-openai-request-id')
  return value === null || value.length === 0 ? undefined : value
}

/** Map an HTTP status to a stable LlmError code. */
function httpErrorCode(status: number, error: any): string {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function modelInfo(provider: string, entry: { id: string; name?: string; description?: string; vision?: boolean }): LlmModelInfo {
  return {
    provider,
    id: entry.id,
    name: entry.name ?? entry.id,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    inputModalities: entry.vision ? ['text', 'image'] : ['text'],
  }
}

/** Per-request facts the registering plugin owns and resolves lazily. */
export interface AdapterConfig {
  /** Connection facts for one registered route; throws when unknown. */
  connectionFor(provider: string): RouteConnection
  /** Bearer token for one route; `undefined` sends no auth header. */
  resolveApiKey(provider: string): Promise<string | undefined>
  /** Image bytes for one attachment ref; `undefined` = unavailable. */
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<Uint8Array | undefined>
  /** Stable anonymous user id stamped on every request. */
  resolveUserId(): string
  /** Global fallbacks for catalog entries that do not declare capacities. */
  fallbacks(): { maxTokens: number; defaultContextWindow: number; streamIdleTimeoutMs: number }
  /** Provider-owned retry policy captured with the registration. */
  retryPolicy(): ResolvedRetryPolicy
}

export class OpenAiCompatibleAdapter extends LlmAdapter {
  constructor(private readonly config: AdapterConfig) {
    super()
  }

  providerInfo(provider: string) {
    return { id: provider, name: this.config.connectionFor(provider).displayName }
  }

  providerRetryPolicy(_provider: string) {
    return this.config.retryPolicy()
  }

  listModels(provider: string) {
    return Promise.resolve(this.config.connectionFor(provider).models.map((model) => modelInfo(provider, model)))
  }

  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const connection = this.config.connectionFor(provider)
    const fallbacks = this.config.fallbacks()
    const configured = connection.models.find((entry) => entry.id === model)
    return Promise.resolve({
      ...(configured === undefined ? modelInfo(provider, { id: model }) : modelInfo(provider, configured)),
      context: { contextWindow: configured?.contextWindow ?? fallbacks.defaultContextWindow },
      defaultMaxTokens: configured?.maxTokens ?? fallbacks.maxTokens,
    })
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const connection = this.config.connectionFor(options.provider)
    const apiKey = await this.config.resolveApiKey(options.provider)
    const userId = this.config.resolveUserId()

    // Resolve image bytes before the request so serialization stays sync.
    const images = new Map<string, ImageBytes>()
    for (const message of options.messages) {
      for (const block of message.content) {
        if (block.type !== 'image' || images.has(block.attachment.attachmentId)) continue
        const data = await this.config.readImage(block.attachment, options.signal)
        if (data === undefined) continue
        images.set(block.attachment.attachmentId, {
          mediaType: block.attachment.mediaType,
          base64: Buffer.from(data).toString('base64'),
        })
      }
    }

    const consumer = new AbortController()
    const watchdog = idleWatchdog(
      options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]),
      this.config.fallbacks().streamIdleTimeoutMs,
      STREAM_IDLE_TIMEOUT_CODE,
    )
    const iterator = this.request(options, watchdog.signal, connection, apiKey, userId, images, () => watchdog.pulse())[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(`OpenAI-compatible stream idle timeout`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('request aborted by caller', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError(`API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await (iterator.return as any)()
        } catch {
          /* transport teardown */
        }
      }
    }
  }

  private async *request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: RouteConnection,
    apiKey: string | undefined,
    userId: string,
    images: ReadonlyMap<string, ImageBytes>,
    onComment: () => void,
  ): AsyncGenerator<StreamChunk> {
    const body = serializeRequest(options, images)
    const payload = JSON.stringify(body)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
      'x-dsh-harness-user-id': String(userId),
      ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(options.sessionId !== undefined ? { 'x-dsh-harness-session-id': String(options.sessionId) } : {}),
      ...(options.purpose === 'compaction' ? { 'x-dsh-harness-compact': '1' } : {}),
    }
    let response: Response
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new LlmError(`API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      let message = `API error (HTTP ${response.status})`
      let providerError: any
      try {
        const body: any = await response.json()
        providerError = body.error
        if (providerError?.message) message = providerError.message
      } catch {
        /* keep the status message */
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...(delay === undefined ? {} : { providerRetryAfterMs: delay }),
        ...(id === undefined ? {} : { requestId: ProviderRequestId(id) }),
      })
    }
    if (!response.body) throw new LlmError('API returned no response body', 'EMPTY_RESPONSE')
    yield* translate(parseSse(response.body))
  }
}
