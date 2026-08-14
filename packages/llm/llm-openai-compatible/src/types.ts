/**
 * Shared option and catalog types for the OpenAI-compatible adapter.
 * @module @dsh-collaboration/llm-openai-compatible/types
 */

/** One advisory catalog entry for a model the endpoint serves. */
export interface ModelEntry {
  /** Model id passed on the wire. */
  id: string
  /** Human-readable name for selectors. */
  name?: string
  /** Optional user-facing distinction. */
  description?: string
  /** Combined request/response context capacity in tokens. */
  contextWindow?: number
  /** Per-request output-token cap. */
  maxTokens?: number
  /** Whether the model accepts image content (`text` + `image` input modalities). */
  vision?: boolean
}

/** Resolved connection facts for one provider route. */
export interface RouteConnection {
  /** Provider route id. */
  provider: string
  /** Human-readable provider name. */
  displayName: string
  /** Full endpoint root, e.g. `https://api.openai.com/v1`. */
  baseURL: string
  /** Credential reference (env-var name); `undefined` = no auth (e.g. Ollama). */
  apiKeyEnv?: string
  /** Resolved advisory catalog in adapter-preferred order. */
  models: readonly ModelEntry[]
}

/** One shipped provider route this adapter owns. */
export interface ProviderRoute {
  /** Route id, also the settings key. */
  id: string
  /** Human-readable display name. */
  displayName: string
  /** Default endpoint root when the profile does not override it. */
  defaultBaseURL: string
  /** Default credential reference (env-var name); absent = no auth. */
  defaultApiKeyEnv?: string
  /** Shipped advisory catalog when the profile does not override it. */
  defaultModels: readonly ModelEntry[]
}
