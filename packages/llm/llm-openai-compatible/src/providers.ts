/**
 * Shipped provider routes and their advisory model catalogs.
 * Every catalog is advisory: the adapter accepts any model id the endpoint
 * serves, and the user can replace a catalog in settings.
 * @module @dsh-openagent/llm-openai-compatible/providers
 */
import type { ProviderRoute } from './types.js'

export const PROVIDER_ROUTES: readonly ProviderRoute[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultApiKeyEnv: 'OPENAI_API_KEY',
    defaultModels: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, vision: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000, maxTokens: 16384, vision: true },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000, maxTokens: 32768, vision: true },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', contextWindow: 1000000, maxTokens: 32768, vision: true },
      { id: 'o3', name: 'o3', contextWindow: 200000, maxTokens: 100000 },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000, maxTokens: 100000, vision: true },
    ],
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    defaultBaseURL: 'https://api.moonshot.cn/v1',
    defaultApiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModels: [
      { id: 'kimi-k2-turbo-preview', name: 'Kimi K2 Turbo', contextWindow: 131072, maxTokens: 8192 },
      { id: 'kimi-k2-0711-preview', name: 'Kimi K2', contextWindow: 131072, maxTokens: 8192 },
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', contextWindow: 8192, maxTokens: 4096 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', contextWindow: 32768, maxTokens: 4096 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', contextWindow: 131072, maxTokens: 4096 },
    ],
  },
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModels: [
      { id: 'qwen3:8b', name: 'Qwen3 8B', contextWindow: 32768, maxTokens: 8192 },
      { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 131072, maxTokens: 8192 },
      { id: 'gemma3:12b', name: 'Gemma 3 12B', contextWindow: 131072, maxTokens: 8192, vision: true },
    ],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    defaultApiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModels: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', contextWindow: 128000, maxTokens: 16384, vision: true },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (OpenRouter)', contextWindow: 200000, maxTokens: 64000, vision: true },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (OpenRouter)', contextWindow: 1000000, maxTokens: 65536, vision: true },
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3 (OpenRouter)', contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    defaultBaseURL: 'https://api.siliconflow.cn/v1',
    defaultApiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModels: [
      { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B', contextWindow: 131072, maxTokens: 8192 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B', contextWindow: 32768, maxTokens: 4096 },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 65536, maxTokens: 8192 },
      { id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen2.5-VL 72B', contextWindow: 32768, maxTokens: 4096, vision: true },
    ],
  },
  {
    id: 'zhipu',
    displayName: 'ZhipuAI (GLM)',
    defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultApiKeyEnv: 'ZHIPUAI_API_KEY',
    defaultModels: [
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000, maxTokens: 8192 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash (free)', contextWindow: 128000, maxTokens: 4096 },
      { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000, maxTokens: 4096 },
      { id: 'glm-4.5v', name: 'GLM-4.5V', contextWindow: 128000, maxTokens: 8192, vision: true },
      { id: 'glm-4v-flash', name: 'GLM-4V Flash (free)', contextWindow: 8192, maxTokens: 4096, vision: true },
    ],
  },
  {
    id: 'groq',
    displayName: 'Groq',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    defaultApiKeyEnv: 'GROQ_API_KEY',
    defaultModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 131072, maxTokens: 8192 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', contextWindow: 131072, maxTokens: 8192 },
      { id: 'qwen-2.5-32b', name: 'Qwen2.5 32B', contextWindow: 131072, maxTokens: 8192 },
    ],
  },
]
